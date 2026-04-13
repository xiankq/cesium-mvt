import type { SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection, Rectangle, WebMercatorTilingScheme } from 'cesium';
import type { TileAvailability } from './source/tile-selection';
import type { FeatureStateTarget } from './style/feature-state-store';
import { RequestScheduler } from 'cesium';
import { RenderManager } from './render';
import { compileRenderTile } from './render/render-tile';
import {
  computeTileLifecycle,
  SourceManager,
  TileCacheManager,
  TileScheduler,
} from './source';
import { isThrottleError } from './source/request-scheduler';
import { FeatureStateStore } from './style/feature-state-store';
import { StyleManager } from './style/style-manager';
import { isAbortError } from './utils/common';
import { TileBudget } from './utils/tile-budget';

const DEFAULT_SHARED_CACHE_SIZE = 320 * 1024 * 1024;

interface RequestSchedulerRuntime {
  update: () => void;
}

export interface CesiumVectorTileCoordinatorOptions {
  maximumLevel?: number;
  minimumLevel: number;
  rectangle: Rectangle;
  root: PrimitiveCollection;
  tileWidth: number;
  tilingScheme: WebMercatorTilingScheme;
}

export interface FrameState {
  afterRender?: Array<() => boolean | void>;
  camera: any;
  viewportHeight: number;
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
    });
    this.cacheManager = new TileCacheManager({
      readyTileBudget: sharedTileBudget,
    });
    this.renderManager = new RenderManager({ root: options.root });
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
      const nextRetryAt = this.sourceManager.getNextRetryAt(this.requestedTileKeys);
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
    this.cacheManager.clear();
    this.renderManager.clear();

    if (hadStyle) {
      this.featureStateManager.clear();
    }

    this.styleManager.updateStyle({ style });
    this.sourceManager.reconcileSources(style.sources as Record<string, SourceSpecification>);
    this.renderManager.updateLayerFamilies(style, this.styleManager.getLayerFamilies());
    this.scheduler.invalidate();
    this.renderRequested = true;
  }

  getStyle(): StyleSpecification | undefined {
    return this.styleManager.getStyle();
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

    this.renderManager.refreshSource(
      target.sourceId,
      key => this.cacheManager.get(key),
      style,
    );
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

  private processTileSelection(coordinates: any[]): void {
    if (!this.styleManager.hasStyle()) {
      return;
    }

    const availableSourceIds = this.sourceManager.getSourceIds();
    const visibleKeys = new Set<string>();
    const nextRequestedKeys = new Set<string>();
    let nextPriority = 0;

    for (const sourceId of availableSourceIds) {
      const constraints = this.sourceManager.getSourceConstraints(sourceId);
      const sourceSelection = this.scheduler.resolveSourceTiles(
        coordinates,
        sourceId,
        (sid: string, level: number, x: number, y: number) =>
          this.getTileAvailability(sid, level, x, y),
        constraints,
      );

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
        void this.requestTile(sourceId, coord.level, coord.x, coord.y, nextPriority);
        nextPriority++;
      }
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

    this.hideInvisibleTiles(visibleKeys);
  }

  private hideInvisibleTiles(visibleKeys: Set<string>): void {
    const allKeys = this.renderManager.getAllKeys();
    for (const key of allKeys) {
      if (!visibleKeys.has(key)) {
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

    if (this.renderManager.hasHandle(key)) {
      return;
    }

    if (this.cacheManager.has(key)) {
      const tile = this.cacheManager.get(key)!;
      const style = this.styleManager.getStyle();
      if (style) {
        this.renderManager.mount(key, tile, style);
      }
      return;
    }

    const style = this.styleManager.getStyle();
    if (!style) {
      return;
    }

    const renderTile = compileRenderTile({
      key: `${sourceId}/${level}/${x}/${y}`,
      layerFamilies: this.renderManager.getLayerFamilies(),
      renderOrder: this.renderManager.getRenderOrder(),
      style,
      styleEpoch: this.styleManager.getStyleEpoch(),
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
      () => {},
      priority,
    );
    this.cacheManager.setPending(key, requestPromise);

    try {
      const tile = await requestPromise;

      // 使用 epoch 检测样式是否在请求期间发生了变化
      if (this.styleManager.getStyleEpoch() !== renderTile.epoch) {
        return;
      }

      if (tile === undefined) {
        return;
      }

      this.renderManager.mount(key, tile, style);
      this.cacheManager.set(key, tile);
      this.renderRequested = true;
    }
    catch (error) {
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
