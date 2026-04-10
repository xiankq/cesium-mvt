import type { SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Rectangle, Scene } from 'cesium';
import type { BucketRenderedTileHandle } from './render/bucket-rendered-tile';
import type { RenderEntry } from './render/render-order';
import type { RenderTile } from './render/render-tile';
import type { TileFrameResult } from './source/tile-manager';
import type { TileCoordinate } from './source/tile-request';
import type { LayerFamily } from './style/layer-family';
import type { StyleSet } from './style/style-set';
import type { TileAvailability } from './tile-selection';
import type { SceneViewTileSelection } from './view-state';
import type { ParsedTileResult } from './worker/bucket/bucket-types';
import { PrimitiveCollection, WebMercatorTilingScheme } from 'cesium';
import { calculateDynamicCacheSize, TileCache } from './cache/tile-cache';
import {
  createBucketRenderedTileHandle,
  createEmptyBucketRenderedTileHandle,
  destroyBucketRenderedTileHandle,
  mountBucketRenderedTileHandle,
  setBucketRenderedTileVisibility,
} from './render/bucket-rendered-tile';
import { createRenderOrder } from './render/render-order';
import {
  compileRenderTile,
  createRenderTileKey,
  createScopedRenderTileKey,
} from './render/render-tile';
import { GeojsonSourceCache } from './source/geojson-source-cache';
import { SourceCache } from './source/source-cache';
import { TileManager } from './source/tile-manager';
import { createLayerFamilies } from './style/layer-family';
import { resolveTileSelection } from './tile-selection';
import { isAbortError } from './utils/abort';
import { collectSceneViewTileSelection } from './view-state';
import { createBucketTileDispatcher } from './worker/bucket-tile-dispatcher';

// SceneLayer 统一持有 Cesium 侧运行时对象：source cache、解析结果、
// 渲染计划以及已挂载的 primitive 句柄。ImageryProvider 只把入口请求委托到这里。
interface TileSourceCache {
  abortTile?: (key: string) => void;
  destroy: () => void;
  getMaxZoom?: () => number | undefined;
  getMinZoom?: () => number | undefined;
  isDestroyed: () => boolean;
  readonly sourceType: SourceSpecification['type'];
  requestTile: (coordinate: TileCoordinate) => Promise<ArrayBuffer>;
  updateSource: (source: SourceSpecification) => void;
}

interface PendingBucketTileRequest {
  abortController: AbortController;
  cleanup: () => void;
}

interface PendingRenderedTileJob {
  key: string;
  resolve: (handle: BucketRenderedTileHandle) => void;
  run: () => BucketRenderedTileHandle;
}

export interface SceneLayerOptions {
  maximumLevel?: number;
  maximumRenderedTilesPerFrame?: number;
  minimumLevel?: number;
  onError?: (error: unknown) => void;
  rectangle?: Rectangle;
  tileWidth?: number;
  tilingScheme?: WebMercatorTilingScheme;
}

export class SceneLayer {
  readonly tileManager = new TileManager();

  private currentFrame = 0;
  private readonly maximumLevel: number | undefined;
  private readonly maximumRenderedTilesPerFrame: number;
  private readonly minimumLevel: number;
  private readonly onError?: (error: unknown) => void;
  private readonly rectangle: Rectangle;
  private readonly scene: Scene;
  private readonly root: PrimitiveCollection;
  private readonly removePostRenderListener?: () => void;
  private readonly removePreRenderListener?: () => void;
  private readonly sourceCaches = new Map<string, TileSourceCache>();
  private readonly tileWidth: number;
  private readonly tilingScheme: WebMercatorTilingScheme;
  private destroyed = false;
  private readonly bucketTileDispatcher = createBucketTileDispatcher();
  private frameUpdateActive = false;
  private frameUpdatePending = true;
  private readonly bucketTileRequests = new Map<
    string,
    PendingBucketTileRequest
  >();

  private readonly bucketTilePromises = new Map<
    string,
    Promise<ParsedTileResult>
  >();

  private readonly bucketTiles = new Map<string, ParsedTileResult>();
  private readonly bucketTileCache: TileCache;
  private readonly hiddenRenderedTileCache: TileCache;
  private layerFamilies: LayerFamily[] = [];
  private lastViewSelectionKey?: string;
  private readonly pendingRenderedTileJobs: PendingRenderedTileJob[] = [];
  private renderedTileCreatesThisFrame = 0;
  private readonly renderedTilePromises = new Map<
    string,
    Promise<BucketRenderedTileHandle>
  >();

  private readonly renderedTileHandles = new Map<
    string,
    BucketRenderedTileHandle
  >();

  private readonly renderTiles = new Map<string, RenderTile>();
  private renderOrder: RenderEntry[] = [];
  private styleSet?: StyleSet;
  private styleEpoch = 0;

  constructor(scene: Scene, options: SceneLayerOptions = {}) {
    this.scene = scene;
    this.minimumLevel = options.minimumLevel ?? 0;
    this.maximumLevel = options.maximumLevel;
    this.maximumRenderedTilesPerFrame = Math.max(
      1,
      options.maximumRenderedTilesPerFrame ?? 4,
    );
    this.onError = options.onError;
    this.tilingScheme
      = options.tilingScheme ?? new WebMercatorTilingScheme();
    this.rectangle = options.rectangle ?? this.tilingScheme.rectangle;
    this.tileWidth = options.tileWidth ?? 256;
    const cacheSize = calculateDynamicCacheSize({
      height: resolveSceneViewportHeight(scene),
      tileSize: this.tileWidth,
      width: resolveSceneViewportWidth(scene),
    });
    this.bucketTileCache = new TileCache({ maxBytes: cacheSize });
    this.hiddenRenderedTileCache = new TileCache({ maxBytes: cacheSize });
    this.root = new PrimitiveCollection();
    this.scene.primitives.add(this.root);
    this.removePreRenderListener = this.scene.preRender?.addEventListener(
      () => {
        this.beginFrameUpdateIfNeeded();
      },
    );
    this.removePostRenderListener = this.scene.postRender?.addEventListener(
      () => {
        if (!this.frameUpdateActive) {
          return;
        }

        this.frameUpdateActive = false;
        const frameResult = this.tileManager.endFrame();
        this.applyFrameResult(frameResult);
      },
    );
  }

  updateStyle(styleSet: StyleSet) {
    this.styleSet = styleSet;
    this.styleEpoch += 1;
    this.layerFamilies = createLayerFamilies(styleSet.style);
    this.clearRenderedTileHandles();
    this.cancelPendingBucketTiles();
    this.flushPendingRenderedTileJobs();
    this.bucketTileCache.clear();
    this.hiddenRenderedTileCache.clear();
    this.renderedTilePromises.clear();
    this.bucketTilePromises.clear();
    this.bucketTiles.clear();
    this.renderOrder = createRenderOrder(
      styleSet.style,
      this.layerFamilies,
    );
    this.renderTiles.clear();
    this.frameUpdatePending = true;
    this.lastViewSelectionKey = undefined;
    this.reconcileSourceCaches(styleSet.style.sources);
  }

  getStyle() {
    return this.styleSet;
  }

  getSourceCache(sourceId: string) {
    return this.sourceCaches.get(sourceId);
  }

  getLayerFamilies() {
    return this.layerFamilies;
  }

  getRenderOrder() {
    return this.renderOrder;
  }

  getRenderTile(sourceId: string, level: number, x: number, y: number) {
    if (!this.styleSet) {
      throw new Error('Style has not been initialized.');
    }

    const baseKey = createRenderTileKey(sourceId, level, x, y);
    const renderTileKey = createScopedRenderTileKey(
      baseKey,
      this.styleEpoch,
    );
    const cachedRenderTile = this.renderTiles.get(renderTileKey);
    if (cachedRenderTile) {
      return cachedRenderTile;
    }

    const renderTile = compileRenderTile({
      key: baseKey,
      layerFamilies: this.layerFamilies,
      renderOrder: this.renderOrder,
      style: this.styleSet.style,
      styleEpoch: this.styleEpoch,
    });
    this.renderTiles.set(renderTile.key, renderTile);
    return renderTile;
  }

  async getBucketTile(sourceId: string, level: number, x: number, y: number) {
    if (!this.styleSet) {
      throw new Error('Style has not been initialized.');
    }

    const sourceCache = this.sourceCaches.get(sourceId);
    if (!sourceCache) {
      throw new Error(`Source cache not found: ${sourceId}`);
    }

    const baseKey = createRenderTileKey(sourceId, level, x, y);
    const renderTileKey = createScopedRenderTileKey(
      baseKey,
      this.styleEpoch,
    );
    const cachedBucketTile = this.bucketTiles.get(renderTileKey);
    if (cachedBucketTile) {
      this.bucketTileCache.touch(renderTileKey);
      return cachedBucketTile;
    }

    const pendingBucketTile = this.bucketTilePromises.get(renderTileKey);
    if (pendingBucketTile) {
      return pendingBucketTile;
    }

    const sourceTileKey = createRenderTileKey(sourceId, level, x, y);
    const abortController = new AbortController();
    const abortSourceRequest = () => {
      sourceCache.abortTile?.(sourceTileKey);
    };
    abortController.signal.addEventListener('abort', abortSourceRequest, {
      once: true,
    });
    this.bucketTileRequests.set(renderTileKey, {
      abortController,
      cleanup: () => {
        abortController.signal.removeEventListener(
          'abort',
          abortSourceRequest,
        );
      },
    });
    const layerFamilies = this.layerFamilies;
    const renderOrder = this.renderOrder;
    const style = this.styleSet.style;
    const styleEpoch = this.styleEpoch;
    const tilingScheme = this.tilingScheme;
    const bucketTilePromise = sourceCache
      .requestTile({
        level,
        x,
        y,
      })
      .then((tile) => {
        const renderTile
          = this.renderTiles.get(renderTileKey)
            ?? compileRenderTile({
              key: baseKey,
              layerFamilies,
              renderOrder,
              style,
              styleEpoch,
            });
        this.renderTiles.set(renderTile.key, renderTile);
        return this.bucketTileDispatcher.compile({
          renderTile,
          signal: abortController.signal,
          tileData: tile,
          tilingScheme,
        });
      })
      .then((bucketTile) => {
        this.cacheBucketTile(bucketTile);
        return bucketTile;
      })
      .finally(() => {
        this.bucketTileRequests.get(renderTileKey)?.cleanup();
        this.bucketTileRequests.delete(renderTileKey);
        this.bucketTilePromises.delete(renderTileKey);
      });

    this.bucketTilePromises.set(renderTileKey, bucketTilePromise);
    return bucketTilePromise;
  }

  async ensureRenderedTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ) {
    return this.resolveRenderedTile(sourceId, level, x, y, false);
  }

  async requestTileHint(level: number, x: number, y: number) {
    const sourceIds = getRenderableSourceIds(this.layerFamilies);
    await Promise.all(
      sourceIds.map(sourceId =>
        this.requestSourceTileHint(sourceId, level, x, y),
      ),
    );
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    for (const sourceCache of this.sourceCaches.values()) {
      sourceCache.destroy();
    }
    this.sourceCaches.clear();
    this.cancelPendingBucketTiles();
    this.flushPendingRenderedTileJobs();
    this.bucketTileDispatcher.destroy();
    this.clearRenderedTileHandles();
    this.renderedTilePromises.clear();
    this.bucketTilePromises.clear();
    this.bucketTiles.clear();
    this.layerFamilies = [];
    this.renderTiles.clear();
    this.renderOrder = [];
    this.removePreRenderListener?.();
    this.removePostRenderListener?.();
    this.scene.primitives.remove(this.root);
    this.destroyed = true;
  }

  private async resolveRenderedTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
    deferCreation: boolean,
  ) {
    if (!this.styleSet) {
      throw new Error('Style has not been initialized.');
    }

    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    const styleEpoch = this.styleEpoch;
    const cachedHandle = this.renderedTileHandles.get(renderTileKey);
    if (cachedHandle) {
      return cachedHandle;
    }

    const pendingHandle = this.renderedTilePromises.get(renderTileKey);
    if (pendingHandle) {
      return pendingHandle;
    }

    const renderedTilePromise = this.getBucketTile(sourceId, level, x, y)
      .then((bucketTile) => {
        if (
          this.destroyed
          || styleEpoch !== this.styleEpoch
          || !this.styleSet
        ) {
          return createEmptyBucketRenderedTileHandle(renderTileKey);
        }

        if (deferCreation) {
          return this.enqueueRenderedTileCreationJob({
            bucketTile,
            key: renderTileKey,
            styleEpoch,
          });
        }

        return this.createAndMountRenderedTileHandle({
          bucketTile,
          key: renderTileKey,
          styleEpoch,
        });
      })
      .catch((error) => {
        if (this.destroyed || styleEpoch !== this.styleEpoch) {
          return createEmptyBucketRenderedTileHandle(renderTileKey);
        }

        const emptyHandle
          = createEmptyBucketRenderedTileHandle(renderTileKey);
        this.renderedTileHandles.set(renderTileKey, emptyHandle);
        this.onError?.(error);
        return emptyHandle;
      })
      .finally(() => {
        this.renderedTilePromises.delete(renderTileKey);
      });

    this.renderedTilePromises.set(renderTileKey, renderedTilePromise);
    return renderedTilePromise;
  }

  private reconcileSourceCaches(
    sources: Record<string, SourceSpecification>,
  ) {
    const nextSourceIds = new Set(Object.keys(sources));

    for (const [sourceId, source] of Object.entries(sources)) {
      const sourceCache = this.sourceCaches.get(sourceId);
      if (sourceCache && sourceCache.sourceType === source.type) {
        sourceCache.updateSource(source);
        continue;
      }

      sourceCache?.destroy();
      this.sourceCaches.delete(sourceId);

      const nextSourceCache = createTileSourceCache(sourceId, source);
      if (nextSourceCache) {
        this.sourceCaches.set(sourceId, nextSourceCache);
      }
    }

    for (const [sourceId, sourceCache] of this.sourceCaches) {
      if (nextSourceIds.has(sourceId)) {
        continue;
      }

      sourceCache.destroy();
      this.sourceCaches.delete(sourceId);
    }
  }

  private clearRenderedTileHandles(): void {
    for (const handle of this.renderedTileHandles.values()) {
      destroyBucketRenderedTileHandle(this.root, handle);
    }
    this.renderedTileHandles.clear();
    this.hiddenRenderedTileCache.clear();
  }

  private applyFrameResult(frameResult: TileFrameResult) {
    let sceneChanged = false;

    for (const key of frameResult.hiddenKeys) {
      const handle = this.renderedTileHandles.get(key);
      if (!handle) {
        continue;
      }

      sceneChanged
        = setBucketRenderedTileVisibility(handle, false) || sceneChanged;
      this.cacheHiddenRenderedTileHandle(key, handle);
    }

    for (const key of frameResult.unloadableKeys) {
      const handle = this.renderedTileHandles.get(key);
      if (!handle) {
        continue;
      }

      if (handle.byteLength === 0) {
        this.destroyRenderedTileHandle(key, handle);
        sceneChanged = true;
      }
    }

    if (sceneChanged) {
      this.scene.requestRender();
    }
    this.frameUpdatePending = frameResult.hiddenKeys.length > 0;
  }

  private beginFrameUpdateIfNeeded(): void {
    const tileSelection = collectSceneViewTileSelection({
      camera: this.scene.camera,
      maximumLevel: this.maximumLevel,
      minimumLevel: this.minimumLevel,
      rectangle: this.rectangle,
      tileWidth: this.tileWidth,
      tilingScheme: this.tilingScheme,
      viewportWidth: resolveSceneViewportWidth(this.scene),
    });

    if (!this.shouldUpdateFrame(tileSelection)) {
      return;
    }

    this.frameUpdateActive = true;
    this.frameUpdatePending = false;
    this.lastViewSelectionKey = tileSelection?.key;
    this.currentFrame += 1;
    this.tileManager.beginFrame(this.currentFrame);
    this.renderedTileCreatesThisFrame = 0;
    this.processPendingRenderedTileJobs();
    if (!tileSelection) {
      return;
    }

    const sourceIds = getRenderableSourceIds(this.layerFamilies);
    void Promise.all(
      sourceIds.map(sourceId =>
        this.requestVisibleTilesForSource(
          sourceId,
          tileSelection.coordinates,
        ),
      ),
    ).catch((error) => {
      this.onError?.(error);
    });
  }

  private shouldUpdateFrame(
    tileSelection: SceneViewTileSelection | undefined,
  ): boolean {
    if (this.pendingRenderedTileJobs.length > 0) {
      return true;
    }

    if (this.frameUpdatePending) {
      return true;
    }

    if (!tileSelection && this.renderedTileHandles.size > 0) {
      return true;
    }

    if (tileSelection && this.renderedTileHandles.size === 0) {
      return true;
    }

    return tileSelection?.key !== this.lastViewSelectionKey;
  }

  private async requestVisibleTilesForSource(
    sourceId: string,
    coordinates: readonly TileCoordinate[],
  ): Promise<void> {
    const sourceCache = this.sourceCaches.get(sourceId);
    const maxZoom = sourceCache?.getMaxZoom?.();
    const minZoom = sourceCache?.getMinZoom?.();

    const tileSelection = resolveTileSelection({
      coordinates,
      getAvailability: coordinate =>
        this.getTileAvailability(
          sourceId,
          coordinate.level,
          coordinate.x,
          coordinate.y,
        ),
      maximumLevel: maxZoom,
      minimumLevel: minZoom ?? this.minimumLevel,
    });

    for (const coordinate of tileSelection.readyCoordinates) {
      this.showResolvedTile(
        sourceId,
        coordinate.level,
        coordinate.x,
        coordinate.y,
      );
    }

    for (const coordinate of tileSelection.emptyCoordinates) {
      this.retainResolvedTile(
        sourceId,
        coordinate.level,
        coordinate.x,
        coordinate.y,
      );
    }

    for (const coordinate of tileSelection.fallbackCoordinates) {
      this.showResolvedTile(
        sourceId,
        coordinate.level,
        coordinate.x,
        coordinate.y,
      );
    }

    await Promise.all(
      tileSelection.requestCoordinates.map(coordinate =>
        this.requestSourceTileHint(
          sourceId,
          coordinate.level,
          coordinate.x,
          coordinate.y,
          true,
        ),
      ),
    );
  }

  private async requestSourceTileHint(
    sourceId: string,
    level: number,
    x: number,
    y: number,
    deferCreation = false,
  ): Promise<void> {
    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    this.tileManager.markCandidate(renderTileKey);
    this.tileManager.markSelected(renderTileKey);

    const cachedHandle = this.renderedTileHandles.get(renderTileKey);
    if (cachedHandle) {
      this.promoteRenderedTileHandle(renderTileKey);
      if (cachedHandle.byteLength > 0) {
        const visibilityChanged = setBucketRenderedTileVisibility(
          cachedHandle,
          true,
        );
        this.tileManager.markShown(renderTileKey);
        if (visibilityChanged) {
          this.scene.requestRender();
        }
      }
      else {
        this.tileManager.touch(renderTileKey);
      }
      return;
    }

    this.tileManager.setBlockers(renderTileKey, {
      requesting: true,
    });

    try {
      const renderedTileHandle = await this.resolveRenderedTile(
        sourceId,
        level,
        x,
        y,
        deferCreation,
      );
      this.tileManager.setBlockers(renderTileKey, {
        requesting: false,
      });
      if (renderedTileHandle.byteLength > 0) {
        this.tileManager.markShown(renderTileKey);
      }
      else {
        this.tileManager.touch(renderTileKey);
      }
    }
    catch (error) {
      this.tileManager.setBlockers(renderTileKey, {
        requesting: false,
      });
      if (isAbortError(error)) {
        return;
      }
      throw error;
    }
  }

  private getTileAvailability(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): TileAvailability {
    const renderedTileHandle = this.renderedTileHandles.get(
      this.resolveRenderTileKey(sourceId, level, x, y),
    );
    if (!renderedTileHandle) {
      return 'missing';
    }

    return renderedTileHandle.byteLength > 0 ? 'ready' : 'empty';
  }

  private retainResolvedTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): void {
    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    this.tileManager.markCandidate(renderTileKey);
    this.tileManager.markSelected(renderTileKey);
    this.tileManager.touch(renderTileKey);
  }

  private showResolvedTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): void {
    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    const renderedTileHandle = this.renderedTileHandles.get(renderTileKey);
    if (!renderedTileHandle) {
      return;
    }

    if (renderedTileHandle.byteLength === 0) {
      this.retainResolvedTile(sourceId, level, x, y);
      return;
    }

    this.promoteRenderedTileHandle(renderTileKey);
    const visibilityChanged = setBucketRenderedTileVisibility(
      renderedTileHandle,
      true,
    );
    this.tileManager.markShown(renderTileKey);
    if (visibilityChanged) {
      this.scene.requestRender();
    }
  }

  private resolveRenderTileKey(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): string {
    return createScopedRenderTileKey(
      createRenderTileKey(sourceId, level, x, y),
      this.styleEpoch,
    );
  }

  private cancelPendingBucketTiles(): void {
    for (const request of this.bucketTileRequests.values()) {
      request.abortController.abort();
    }
    this.bucketTileRequests.clear();
  }

  private createAndMountRenderedTileHandle({
    bucketTile,
    countTowardsBudget = false,
    key,
    styleEpoch,
  }: {
    bucketTile: ParsedTileResult;
    countTowardsBudget?: boolean;
    key: string;
    styleEpoch: number;
  }): BucketRenderedTileHandle {
    if (
      this.destroyed
      || styleEpoch !== this.styleEpoch
      || !this.styleSet
    ) {
      return createEmptyBucketRenderedTileHandle(key);
    }

    if (countTowardsBudget) {
      this.renderedTileCreatesThisFrame += 1;
    }

    const renderedTileHandle = createBucketRenderedTileHandle({
      bucketTile,
      style: this.styleSet.style,
    });
    mountBucketRenderedTileHandle(this.root, renderedTileHandle);
    this.renderedTileHandles.set(
      renderedTileHandle.key,
      renderedTileHandle,
    );
    this.frameUpdatePending = true;
    if (renderedTileHandle.byteLength > 0) {
      this.scene.requestRender();
    }
    return renderedTileHandle;
  }

  private enqueueRenderedTileCreationJob({
    bucketTile,
    key,
    styleEpoch,
  }: {
    bucketTile: ParsedTileResult;
    key: string;
    styleEpoch: number;
  }): Promise<BucketRenderedTileHandle> {
    if (this.canCreateRenderedTileThisFrame()) {
      return Promise.resolve(
        this.createAndMountRenderedTileHandle({
          bucketTile,
          countTowardsBudget: true,
          key,
          styleEpoch,
        }),
      );
    }

    return new Promise((resolve) => {
      this.pendingRenderedTileJobs.push({
        key,
        resolve,
        run: () =>
          this.createAndMountRenderedTileHandle({
            bucketTile,
            countTowardsBudget: true,
            key,
            styleEpoch,
          }),
      });
      this.frameUpdatePending = true;
      this.scene.requestRender();
    });
  }

  private processPendingRenderedTileJobs(): void {
    while (
      this.canCreateRenderedTileThisFrame()
      && this.pendingRenderedTileJobs.length > 0
    ) {
      const job = this.pendingRenderedTileJobs.shift();
      if (!job) {
        break;
      }

      job.resolve(job.run());
    }

    if (this.pendingRenderedTileJobs.length > 0) {
      this.frameUpdatePending = true;
      this.scene.requestRender();
    }
  }

  private flushPendingRenderedTileJobs(): void {
    while (this.pendingRenderedTileJobs.length > 0) {
      const job = this.pendingRenderedTileJobs.shift();
      if (!job) {
        continue;
      }

      job.resolve(createEmptyBucketRenderedTileHandle(job.key));
    }
  }

  private canCreateRenderedTileThisFrame(): boolean {
    return (
      this.frameUpdateActive
      && this.renderedTileCreatesThisFrame
      < this.maximumRenderedTilesPerFrame
    );
  }

  private cacheBucketTile(bucketTile: ParsedTileResult): void {
    this.bucketTiles.set(bucketTile.key, bucketTile);
    const evictedEntries = this.bucketTileCache.add(bucketTile.key, {
      byteLength: bucketTile.byteLength,
    });

    for (const entry of evictedEntries) {
      this.bucketTiles.delete(entry.key);
    }
  }

  private cacheHiddenRenderedTileHandle(
    key: string,
    handle: BucketRenderedTileHandle,
  ): void {
    const evictedEntries = this.hiddenRenderedTileCache.add(key, {
      byteLength: handle.byteLength,
      handle,
    });

    for (const entry of evictedEntries) {
      const evictedHandle = entry.entry.handle as
        | BucketRenderedTileHandle
        | undefined;
      if (!evictedHandle) {
        continue;
      }

      this.destroyRenderedTileHandle(entry.key, evictedHandle);
    }
  }

  private promoteRenderedTileHandle(key: string): void {
    this.hiddenRenderedTileCache.delete(key);
  }

  private destroyRenderedTileHandle(
    key: string,
    handle: BucketRenderedTileHandle,
  ): void {
    destroyBucketRenderedTileHandle(this.root, handle);
    this.renderedTileHandles.delete(key);
  }
}

function createTileSourceCache(
  sourceId: string,
  source: SourceSpecification,
): TileSourceCache | undefined {
  if (source.type === 'vector') {
    return new SourceCache<ArrayBuffer>({
      source,
      sourceId,
    });
  }

  if (source.type === 'geojson') {
    return new GeojsonSourceCache({
      source,
      sourceId,
    });
  }

  return undefined;
}

function getRenderableSourceIds(layerFamilies: LayerFamily[]): string[] {
  return [
    ...new Set(layerFamilies.map(layerFamily => layerFamily.sourceId)),
  ];
}

function resolveSceneViewportWidth(scene: Scene): number {
  const canvasWidth = scene.canvas as
    | {
      clientWidth?: number;
      width?: number;
    }
    | undefined;
  return canvasWidth?.clientWidth ?? canvasWidth?.width ?? 256;
}

function resolveSceneViewportHeight(scene: Scene): number {
  const canvasHeight = scene.canvas as
    | {
      clientHeight?: number;
      height?: number;
    }
    | undefined;
  return canvasHeight?.clientHeight ?? canvasHeight?.height ?? 256;
}
