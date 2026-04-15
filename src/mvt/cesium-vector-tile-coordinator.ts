import type { SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection, Rectangle, WebMercatorTilingScheme } from 'cesium';
import type { QueryRenderedFeaturesOptions } from './render';
import type { RenderManagerMetrics } from './render/render-manager';
import type { RenderedFeature } from './render/render-query';
import type { SourceManagerMetrics } from './source/source-manager';
import type { QuerySourceFeaturesOptions } from './source/source-query';
import type { TileCacheManagerMetrics } from './source/tile-cache-manager';
import type { TileCoordinate } from './source/tile-request';
import type { TileAvailability } from './source/tile-selection';
import type { FeatureStateTarget } from './style/feature-state-store';
import { RequestScheduler } from 'cesium';
import { queryRenderedFeaturesFromState, RenderManager } from './render';
import { compileRenderTile } from './render/render-tile';
import {
  computeTileLifecycle,
  SourceManager,
  TileCacheManager,
  TileScheduler,
} from './source';
import { isThrottleError } from './source/request-scheduler';
import { computeTilePriority } from './source/tile-priority';
import { FeatureStateStore } from './style/feature-state-store';
import { StyleManager } from './style/style-manager';
import { isAbortError } from './utils/common';
import { TileBudget } from './utils/tile-budget';

const DEFAULT_SHARED_CACHE_SIZE = 320 * 1024 * 1024;

interface RequestSchedulerRuntime {
  update: () => void;
}

export interface CesiumVectorTileCoordinatorOptions {
  crossSourceCollisions?: boolean;
  maximumCacheOverflowBytes?: number;
  maximumLevel?: number;
  minimumLevel: number;
  rectangle: Rectangle;
  root: PrimitiveCollection;
  tileWidth: number;
  tilingScheme: WebMercatorTilingScheme;
}

export interface CesiumVectorTileCoordinatorMetrics {
  cache: TileCacheManagerMetrics;
  render: RenderManagerMetrics;
  source: SourceManagerMetrics;
}

export interface FrameState {
  afterRender?: Array<() => boolean | void>;
  camera: any;
  viewportWidth: number;
}

export class CesiumVectorTileCoordinator {
  private destroyed = false;
  private readonly scheduler: TileScheduler;
  private readonly cacheManager: TileCacheManager;
  private readonly renderManager: RenderManager;
  private readonly sourceManager: SourceManager;
  private readonly styleManager: StyleManager;
  private readonly featureStateManager: FeatureStateStore;
  private readonly tilingScheme: WebMercatorTilingScheme;
  private readonly requestedTileKeys = new Set<string>();
  private readonly requestedSourceIds = new Set<string>();
  private renderRequested = false;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  constructor(options: CesiumVectorTileCoordinatorOptions) {
    this.tilingScheme = options.tilingScheme;

    this.scheduler = new TileScheduler({
      maximumLevel: options.maximumLevel,
      minimumLevel: options.minimumLevel,
      rectangle: options.rectangle,
      tileWidth: options.tileWidth,
      tilingScheme: options.tilingScheme,
    });

    const sharedTileBudget = new TileBudget({
      maxBytes: DEFAULT_SHARED_CACHE_SIZE,
      maximumCacheOverflowBytes: options.maximumCacheOverflowBytes,
    });
    this.cacheManager = new TileCacheManager({
      readyTileBudget: sharedTileBudget,
    });
    this.renderManager = new RenderManager({
      crossSourceCollisions: options.crossSourceCollisions,
      root: options.root,
      tileWidth: options.tileWidth,
    });
    this.cacheManager.setOnEvict((key: string) => {
      this.renderManager.remove(key);
    });
    this.featureStateManager = new FeatureStateStore();
    this.renderManager.setFeatureStateResolver(
      target => this.featureStateManager.getFeatureState(target),
    );
    this.sourceManager = new SourceManager({
      readyTileBudget: sharedTileBudget,
    });
    this.styleManager = new StyleManager();
  }

  update(frameState: FrameState): void {
    if (this.destroyed) {
      return;
    }

    try {
      this.cacheManager.beginFrame();

      const nextRetryAt = this.sourceManager.getNextRetryAtForSourceIds?.(this.requestedSourceIds)
        ?? this.sourceManager.getNextRetryAt(this.requestedSourceIds);
      if (nextRetryAt !== undefined && Date.now() >= nextRetryAt) {
        this.scheduler.invalidate();
      }

      const tileSelection = this.scheduler.schedule(
        frameState.camera,
        frameState.viewportWidth,
      );

      if (!tileSelection || !this.scheduler.shouldUpdate(tileSelection)) {
        return;
      }

      this.scheduler.commit(tileSelection);
      this.processTileSelection(tileSelection.coordinates);
    }
    finally {
      (RequestScheduler as unknown as RequestSchedulerRuntime).update();
    }
  }

  updateStyle(style: StyleSpecification): void {
    if (this.destroyed) {
      return;
    }

    const hadStyle = this.styleManager.hasStyle();
    this.sourceManager.abortAll();
    this.requestedTileKeys.clear();
    this.requestedSourceIds.clear();
    this.cacheManager.clear();
    this.renderManager.clear();

    if (hadStyle) {
      this.featureStateManager.clear();
    }

    this.styleManager.updateStyle({ style });
    this.sourceManager.reconcileSources(style.sources as Record<string, SourceSpecification>);
    const styleIndex = this.styleManager.getStyleIndex();
    this.renderManager.updateLayerFamilies(
      style,
      this.styleManager.getLayerFamilies(),
      styleIndex?.renderOrder,
    );
    this.scheduler.invalidate();
    this.renderRequested = true;
  }

  getStyle(): StyleSpecification | undefined {
    return this.styleManager.getStyle();
  }

  querySourceFeatures(
    sourceId: string,
    options: QuerySourceFeaturesOptions = {},
  ) {
    return this.sourceManager.querySourceFeatures(sourceId, options);
  }

  queryRenderedFeatures(
    options: QueryRenderedFeaturesOptions = {},
  ): RenderedFeature[] {
    const style = this.styleManager.getStyle();
    if (!style) {
      return [];
    }

    return queryRenderedFeaturesFromState({
      getFeatureState: target => this.featureStateManager.getFeatureState(target),
      getSourceCache: sourceId => this.sourceManager.getSourceCache(sourceId),
      renderManager: this.renderManager,
      style,
    }, options);
  }

  setFeatureState(
    target: FeatureStateTarget,
    state: Record<string, unknown>,
  ): void {
    if (this.destroyed) {
      return;
    }

    const changed = this.featureStateManager.setFeatureState(target, state);
    if (!changed) {
      return;
    }

    const style = this.styleManager.getStyle();
    if (!style) {
      return;
    }

    const styleIndex = this.styleManager.getStyleIndex();

    if (target.sourceLayer) {
      this.renderManager.refreshSourceLayer(
        target.sourceId,
        target.sourceLayer,
        key => this.cacheManager.get(key),
        style,
        styleIndex,
      );
    }
    else {
      this.renderManager.refreshSource(
        target.sourceId,
        key => this.cacheManager.get(key),
        style,
        styleIndex,
      );
    }
    this.renderRequested = true;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.sourceManager.destroy();
    this.cacheManager.destroy();
    this.renderManager.destroy();
    this.featureStateManager.clear();
    this.requestedTileKeys.clear();
    this.renderRequested = false;
  }

  prePassesUpdate(frameState: FrameState): void {
    if (this.destroyed || !this.renderRequested || !frameState.afterRender) {
      return;
    }

    // 让当前场景在帧尾自己补一次 requestRender，避免把场景能力暴露到外部。
    frameState.afterRender.push(() => {
      this.renderRequested = false;
      return true;
    });
  }

  getMetrics(): CesiumVectorTileCoordinatorMetrics {
    return {
      cache: this.cacheManager.getMetrics(),
      render: this.renderManager.getMetrics(),
      source: this.sourceManager.getMetrics(),
    };
  }

  private processTileSelection(coordinates: any[]): void {
    if (!this.styleManager.hasStyle()) {
      return;
    }

    const availableSourceIds = this.sourceManager.getSourceIds();
    const visibleKeys = new Set<string>();
    const nextRequestedKeys = new Set<string>();
    const nextRequestedSourceIds = new Set<string>();
    const nextRequestCandidateKeys = new Set<string>();
    const requestCandidates: Array<{
      coordinate: TileCoordinate;
      priorityScore: number;
      sourceId: string;
    }> = [];
    const selectionCenter = computeTileSelectionCenter(coordinates);
    const now = Date.now();

    for (const sourceId of availableSourceIds) {
      const constraints = this.sourceManager.getSourceConstraints(sourceId);
      const sourceSelection = this.scheduler.resolveSourceTiles(
        coordinates,
        sourceId,
        (sid: string, level: number, x: number, y: number) =>
          this.getTileAvailability(sid, level, x, y),
        constraints,
      );
      const sourceRetryAt = this.sourceManager.getNextRetryAt(sourceId);

      for (const coord of sourceSelection.readyCoordinates) {
        const key = this.resolveRenderTileKey(sourceId, coord.level, coord.x, coord.y);
        visibleKeys.add(key);
        this.showResolvedTile(sourceId, coord.level, coord.x, coord.y);
      }

      for (const coord of sourceSelection.fallbackCoordinates) {
        const key = this.resolveRenderTileKey(sourceId, coord.level, coord.x, coord.y);
        visibleKeys.add(key);
        this.showResolvedTile(sourceId, coord.level, coord.x, coord.y);
      }

      for (const coord of sourceSelection.requestCoordinates) {
        const key = this.resolveRenderTileKey(sourceId, coord.level, coord.x, coord.y);
        const lifecycle = computeTileLifecycle({
          coordinate: coord,
          isCached: this.cacheManager.has(key),
          isPending: this.cacheManager.hasPending(key),
          isVisible: true,
          sourceConstraints: constraints,
        });

        if (lifecycle === 'show') {
          this.showResolvedTile(sourceId, coord.level, coord.x, coord.y);
          continue;
        }

        nextRequestedKeys.add(key);
        nextRequestedSourceIds.add(sourceId);
        if (nextRequestCandidateKeys.has(key)) {
          continue;
        }
        nextRequestCandidateKeys.add(key);
        requestCandidates.push({
          coordinate: coord,
          priorityScore: computeRequestPriorityScore(
            coord,
            selectionCenter,
            sourceRetryAt,
            now,
          ),
          sourceId,
        });
      }
    }

    requestCandidates.sort(compareRequestCandidates);

    let nextPriority = 0;
    for (const candidate of requestCandidates) {
      void this.requestTile(
        candidate.sourceId,
        candidate.coordinate.level,
        candidate.coordinate.x,
        candidate.coordinate.y,
        nextPriority,
      );
      nextPriority++;
    }

    for (const key of this.requestedTileKeys) {
      if (!nextRequestedKeys.has(key)) {
        this.sourceManager.abort(key);
      }
    }
    this.requestedTileKeys.clear();
    for (const key of nextRequestedKeys) {
      this.requestedTileKeys.add(key);
    }
    this.requestedSourceIds.clear();
    for (const sourceId of nextRequestedSourceIds) {
      this.requestedSourceIds.add(sourceId);
    }

    this.hideInvisibleTiles(visibleKeys);
  }

  private hideInvisibleTiles(visibleKeys: Set<string>): void {
    const currentVisibleKeys = this.renderManager.getVisibleKeys?.();
    const renderKeys = currentVisibleKeys && currentVisibleKeys.length > 0
      ? [...currentVisibleKeys]
      : [...this.renderManager.getAllKeys()];
    for (const key of renderKeys) {
      if (!visibleKeys.has(key)) {
        this.cacheManager.setVisibility(key, false);
        this.renderManager.hide(key);
        if (!this.cacheManager.has(key)) {
          this.renderManager.remove(key);
        }
      }
    }
  }

  private getTileAvailability(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): TileAvailability {
    const key = this.resolveRenderTileKey(sourceId, level, x, y);
    const handle = this.renderManager.getHandle(key);
    if (!handle) {
      return 'missing';
    }
    return handle.byteLength > 0 ? 'ready' : 'empty';
  }

  private showResolvedTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): void {
    const key = this.resolveRenderTileKey(sourceId, level, x, y);
    this.cacheManager.setVisibility(key, true);
    this.renderManager.show(key);
  }

  private async requestTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
    priority = 0,
  ): Promise<void> {
    const key = this.resolveRenderTileKey(sourceId, level, x, y);
    const style = this.styleManager.getStyle();
    const styleIndex = this.styleManager.getStyleIndex();

    if (this.renderManager.hasHandle(key)) {
      return;
    }

    if (this.cacheManager.has(key)) {
      const tile = this.cacheManager.get(key)!;
      if (style) {
        this.renderManager.mount(key, tile, style, styleIndex);
        this.cacheManager.setVisibility(key, true);
      }
      return;
    }

    if (!style) {
      return;
    }

    const renderTile = compileRenderTile({
      key: `${sourceId}/${level}/${x}/${y}`,
      layerFamilies: this.renderManager.getLayerFamilies(),
      renderOrder: this.renderManager.getRenderOrder(),
      style,
      styleEpoch: this.styleManager.getStyleEpoch(),
      styleIndex,
    });

    const requestPromise = this.sourceManager.requestTile(
      sourceId,
      level,
      x,
      y,
      key,
      this.tilingScheme,
      renderTile,
      style,
      priority,
      styleIndex,
    );
    this.cacheManager.setPending(key, requestPromise);

    try {
      const tile = await requestPromise;

      if (this.destroyed) {
        return;
      }

      // 使用 epoch 检测样式是否在请求期间发生了变化
      if (this.styleManager.getStyleEpoch() !== renderTile.epoch) {
        return;
      }

      if (tile === undefined) {
        return;
      }

      this.renderManager.mount(key, tile, style, styleIndex);
      this.cacheManager.set(key, tile);
      this.renderRequested = true;
    }
    catch (error) {
      if (this.destroyed) {
        return;
      }

      if (this.styleManager.getStyleEpoch() !== renderTile.epoch) {
        return;
      }

      if (error === undefined || isAbortError(error) || isThrottleError(error)) {
        return;
      }

      console.error(`[Coordinator] Failed to request tile ${key}:`, error);
    }
    finally {
      this.cacheManager.deletePending(key);
    }
  }

  private resolveRenderTileKey(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): string {
    return `${this.styleManager.getStyleEpoch()}:${sourceId}/${level}/${x}/${y}`;
  }
}

function computeTileSelectionCenter(coordinates: readonly TileCoordinate[]) {
  if (coordinates.length === 0) {
    return { x: 0, y: 0 };
  }

  const firstCoordinate = coordinates[0]!;
  let minX = firstCoordinate.x;
  let maxX = firstCoordinate.x;
  let minY = firstCoordinate.y;
  let maxY = firstCoordinate.y;

  for (let index = 1; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index]!;
    minX = Math.min(minX, coordinate.x);
    maxX = Math.max(maxX, coordinate.x);
    minY = Math.min(minY, coordinate.y);
    maxY = Math.max(maxY, coordinate.y);
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

function computeRequestPriorityScore(
  coordinate: TileCoordinate,
  selectionCenter: { x: number; y: number },
  sourceRetryAt: number | undefined,
  now: number,
): number {
  const distanceToCenter = Math.abs(coordinate.x - selectionCenter.x)
    + Math.abs(coordinate.y - selectionCenter.y);
  const retryPenalty = sourceRetryAt !== undefined && sourceRetryAt > now
    ? (sourceRetryAt - now) / 1000
    : 0;

  return computeTilePriority({
    distanceToCamera: distanceToCenter,
    isLoaded: false,
    level: coordinate.level,
    screenSpaceError: 1 / (1 + coordinate.level),
  }) - retryPenalty;
}

function compareRequestCandidates(
  left: {
    coordinate: TileCoordinate;
    priorityScore: number;
    sourceId: string;
  },
  right: {
    coordinate: TileCoordinate;
    priorityScore: number;
    sourceId: string;
  },
): number {
  if (left.priorityScore !== right.priorityScore) {
    return right.priorityScore - left.priorityScore;
  }

  if (left.sourceId !== right.sourceId) {
    return left.sourceId.localeCompare(right.sourceId);
  }

  if (left.coordinate.level !== right.coordinate.level) {
    return left.coordinate.level - right.coordinate.level;
  }

  if (left.coordinate.y !== right.coordinate.y) {
    return left.coordinate.y - right.coordinate.y;
  }

  return left.coordinate.x - right.coordinate.x;
}
