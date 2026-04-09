import type { Scene, TilingScheme } from '@cesium/engine';
import type { StyleSet } from '../style/style-set';
import type { MvtTile } from '../tile/tile';
import type { TileLoader } from '../tile/tile-loader';
import type { TileStore } from '../tile/tile-store';
import type { PrimitiveFrameState, TileCoordinate, TilesetPrimitiveStats } from '../types';
import type { TileRenderBundle } from './tile-render-bundle';
import { WebMercatorTilingScheme } from '@cesium/engine';
import { isDebugLoggingEnabled, logError } from '../log';
import { parseVectorTile } from '../parse/vector-tile-parser';
import { createFeatureIndex } from '../pick/feature-index';
import { getSourceTileCoordinate } from '../tile/overzoom';
import { SourceTileCache } from '../tile/source-tile-cache';
import { DefaultTileLoader } from '../tile/tile-loader';
import { createWarningContext } from '../warning-context';
import { ParseWorkerClient } from '../worker/parse-worker-client';
import { SymbolCollisionIndex } from './symbol-collision';
import { createTileRenderBundle } from './tile-render-bundle';

export interface TilesetPrimitiveOptions {
  debugLogging?: boolean;
  fallbackFrameWindow?: number;
  getVisibleTileCoordinates?: () => readonly TileCoordinate[];
  maxConcurrentLoads?: number;
  maxParseBytesPerFrame?: number;
  maxParseTilesPerFrame?: number;
  maxSourceCacheBytes?: number;
  maxUploadBytesPerFrame?: number;
  maxUploadTilesPerFrame?: number;
  requestRender?: () => void;
  staleFrameWindow?: number;
  sourceCacheProtectedFrames?: number;
  tileLoaderFactory?: (styleSet: StyleSet) => TileLoader;
  tileStore: TileStore;
  tilingScheme?: TilingScheme;
}

export class TilesetPrimitive {
  private readonly currentVisibleTiles: MvtTile[] = [];
  private readonly debugLogging: boolean;
  private destroyed = false;
  private frameNumber = 0;
  private readonly inflightLoads = new Set<string>();
  private readonly inflightParses = new Set<string>();
  private readonly fallbackFrameWindow: number;
  private readonly getVisibleTileCoordinates?: () => readonly TileCoordinate[];
  private readonly maxConcurrentLoads: number;
  private readonly maxParseBytesPerFrame: number;
  private readonly maxParseTilesPerFrame: number;
  private readonly maxUploadBytesPerFrame: number;
  private readonly maxUploadTilesPerFrame: number;
  private readonly renderBundles = new Map<string, TileRenderBundle>();
  private readonly requestRender?: () => void;
  private readonly sourceTileCache: SourceTileCache;
  private readonly staleFrameWindow: number;
  private readonly parseWorkerClient: ParseWorkerClient;
  private readonly symbolCollisionIndex = new SymbolCollisionIndex();
  private readonly warningContext;
  show = true;

  private tileLoader?: TileLoader;
  private readonly tileLoaderFactory?: (styleSet: StyleSet) => TileLoader;
  private readonly tileStore: TileStore;
  private readonly tilingScheme: TilingScheme;
  private styleSet?: StyleSet;

  constructor(options: TilesetPrimitiveOptions) {
    this.debugLogging = isDebugLoggingEnabled(options.debugLogging);
    this.tileStore = options.tileStore;
    this.getVisibleTileCoordinates = options.getVisibleTileCoordinates;
    this.fallbackFrameWindow = Math.max(0, options.fallbackFrameWindow ?? 2);
    this.maxConcurrentLoads = Math.max(1, options.maxConcurrentLoads ?? 6);
    this.maxParseBytesPerFrame = Math.max(1, options.maxParseBytesPerFrame ?? 2 * 1024 * 1024);
    this.maxParseTilesPerFrame = Math.max(1, options.maxParseTilesPerFrame ?? 4);
    this.maxUploadBytesPerFrame = Math.max(1, options.maxUploadBytesPerFrame ?? 4 * 1024 * 1024);
    this.maxUploadTilesPerFrame = Math.max(1, options.maxUploadTilesPerFrame ?? 8);
    this.requestRender = options.requestRender;
    this.sourceTileCache = new SourceTileCache({
      maxByteLength: options.maxSourceCacheBytes,
      protectedFrames: options.sourceCacheProtectedFrames ?? 2,
    });
    this.staleFrameWindow = Math.max(0, options.staleFrameWindow ?? 1);
    this.tileLoaderFactory = options.tileLoaderFactory;
    this.tilingScheme = options.tilingScheme ?? new WebMercatorTilingScheme();
    this.parseWorkerClient = new ParseWorkerClient({
      debugLogging: this.debugLogging,
    });
    this.warningContext = createWarningContext(this.debugLogging);
  }

  destroy(): undefined {
    this.destroyed = true;
    this.abortAllLoads();
    this.parseWorkerClient.destroy();
    this.destroyAllRenderBundles();
    this.tileStore.clear();
    return undefined;
  }

  getFrameNumber(): number {
    return this.frameNumber;
  }

  getStats(): TilesetPrimitiveStats {
    return {
      cpuCacheBytes: this.tileStore.cpuCacheBytes,
      frameNumber: this.frameNumber,
      gpuCacheBytes: this.tileStore.gpuCacheBytes,
      loadingQueueSize: this.tileStore.loadingQueueSize,
      parseQueueSize: this.tileStore.parseQueueSize,
      sourceCacheBytes: this.sourceTileCache.byteLength,
      tileCount: this.tileStore.tileCount,
      uploadQueueSize: this.tileStore.uploadQueueSize,
    };
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  setStyleSet(styleSet: StyleSet): void {
    if (this.styleSet && this.styleSet !== styleSet) {
      this.abortAllLoads();
      this.destroyAllRenderBundles();
      this.tileStore.clear();
    }

    this.styleSet = styleSet;
    this.tileLoader = this.tileLoaderFactory?.(styleSet) ?? createDefaultTileLoader(styleSet);
  }

  update(frameState: PrimitiveFrameState): void {
    if (!this.show || this.destroyed) {
      return;
    }

    const cesiumFrameState = frameState as unknown as { camera?: { scene?: Scene } };
    const scene = frameState.scene ?? cesiumFrameState.camera?.scene;
    const mvtFrameState = scene ? { ...frameState, scene } : frameState;

    this.frameNumber = mvtFrameState.frameNumber;
    this.tileStore.beginFrame(mvtFrameState.frameNumber);
    this.sourceTileCache.beginFrame(mvtFrameState.frameNumber);

    if (!this.styleSet || !this.tileLoader) {
      this.sourceTileCache.evict();
      this.releaseEvictedTiles(this.tileStore.evictToBudgets());
      return;
    }

    this.syncVisibleTiles();
    this.cancelStaleWork();
    this.startPendingLoads(this.tileLoader);
    this.flushParseQueue(this.styleSet);
    this.flushUploadQueue();
    this.sourceTileCache.evict();
    this.releaseEvictedTiles(this.tileStore.evictToBudgets());
    this.renderReadyTiles(mvtFrameState);
  }

  private abortAllLoads(): void {
    this.inflightLoads.clear();
    this.inflightParses.clear();
    this.sourceTileCache.clear();
  }

  private cancelStaleWork(): void {
    const activeTiles = this.resolveActiveTilesForStaleWork();
    if (!activeTiles.length) {
      return;
    }

    const recentTileKeys = new Set(activeTiles.map(tile => tile.key));
    for (const tile of this.tileStore.getTiles()) {
      if (recentTileKeys.has(tile.key)) {
        continue;
      }
      if (
        tile.state === 'idle'
        || tile.state === 'ready'
        || tile.state === 'failed'
        || tile.state === 'evicted'
      ) {
        continue;
      }

      this.cancelTileWork(tile);
    }
  }

  private cancelTileWork(tile: MvtTile): void {
    tile.buildVersion += 1;
    this.inflightLoads.delete(tile.key);
    this.inflightParses.delete(tile.key);
    this.tileStore.removeFromQueues(tile.key);
    this.sourceTileCache.release(tile.sourceCoordinate, tile.key);
    this.destroyRenderBundle(tile.key);
    tile.clearPayload();
    this.tileStore.updateTileByteLength(tile, { cpu: 0, gpu: 0 });
    tile.setState('idle');
  }

  private destroyAllRenderBundles(): void {
    for (const renderBundle of this.renderBundles.values()) {
      renderBundle.destroy();
    }
    this.renderBundles.clear();
  }

  private destroyRenderBundle(tileKey: string): void {
    const renderBundle = this.renderBundles.get(tileKey);
    if (!renderBundle) {
      return;
    }

    renderBundle.destroy();
    this.renderBundles.delete(tileKey);
  }

  private flushParseQueue(styleSet: StyleSet): void {
    let parsedBytes = 0;
    let parsedTileCount = 0;

    while (parsedTileCount < this.maxParseTilesPerFrame) {
      const tile = this.tileStore.dequeueParse();
      if (!tile) {
        return;
      }

      if (tile.state !== 'parse-queued' || this.inflightParses.has(tile.key)) {
        continue;
      }

      const loadResult = this.sourceTileCache.get(tile.sourceCoordinate);
      if (!loadResult) {
        if (this.inflightLoads.has(tile.key)) {
          this.tileStore.queueParse(tile, tile.priority);
          return;
        }

        this.failTile(tile, 'parse', new Error('解析前 source cache 中不存在对应瓦片数据。'));
        continue;
      }

      const estimatedParseBytes = Math.max(loadResult.byteLength, 1);
      if (
        parsedTileCount > 0
        && parsedBytes + estimatedParseBytes > this.maxParseBytesPerFrame
      ) {
        this.tileStore.queueParse(tile, tile.priority);
        return;
      }

      tile.setState('parsing');
      if (!this.parseWorkerClient.isWorkerEnabled()) {
        try {
          const parsedTileData = parseVectorTile(
            loadResult.arrayBuffer,
            styleSet,
            tile.coordinate.z,
            this.warningContext,
          );
          tile.setParsedTileData(parsedTileData, tile.sourceUrl);
          tile.setState('parsed');
          this.tileStore.updateTileByteLength(tile, {
            cpu: parsedTileData.byteLength,
            gpu: 0,
          });
          this.tileStore.queueUpload(tile, tile.priority);
          tile.setState('upload-queued');
          this.requestRender?.();
        }
        catch (error) {
          this.failTile(tile, 'parse', error);
        }
        finally {
          this.sourceTileCache.release(tile.sourceCoordinate, tile.key);
        }

        parsedBytes += estimatedParseBytes;
        parsedTileCount += 1;
        continue;
      }

      parsedBytes += estimatedParseBytes;
      parsedTileCount += 1;
      void this.startTileParse(tile, styleSet, loadResult.arrayBuffer);
    }
  }

  private flushUploadQueue(): void {
    let uploadedBytes = 0;
    let uploadedTileCount = 0;

    while (uploadedTileCount < this.maxUploadTilesPerFrame) {
      const tile = this.tileStore.dequeueUpload();
      if (!tile) {
        return;
      }

      if (tile.state !== 'parsed' && tile.state !== 'upload-queued') {
        continue;
      }

      const estimatedUploadBytes = Math.max(tile.parsedByteLength, tile.gpuByteLength, 1);
      if (
        uploadedTileCount > 0
        && uploadedBytes + estimatedUploadBytes > this.maxUploadBytesPerFrame
      ) {
        this.tileStore.queueUpload(tile, tile.priority);
        return;
      }

      tile.setState('uploading');
      this.destroyRenderBundle(tile.key);
      try {
        const displayFeatureCache = new WeakMap();
        const featureIndex = tile.parsedTileData
          ? createFeatureIndex({
              coordinate: tile.coordinate,
              displayFeatureCache,
              parsedTileData: tile.parsedTileData,
              sourceCoordinate: tile.sourceCoordinate,
              styleSet: this.styleSet!,
            })
          : undefined;
        const renderBundle = tile.parsedTileData
          ? createTileRenderBundle({
              coordinate: tile.coordinate,
              displayFeatureCache,
              parsedTileData: tile.parsedTileData,
              sourceCoordinate: tile.sourceCoordinate,
              styleSet: this.styleSet!,
              tilingScheme: this.tilingScheme,
              warningContext: this.warningContext,
            })
          : undefined;

        tile.setFeatureIndex(featureIndex);
        tile.clearParsedTileData();
        tile.setMeshData(undefined);
        this.tileStore.updateTileByteLength(tile, {
          cpu: 0,
          gpu: renderBundle?.byteLength ?? 0,
        });

        if (renderBundle) {
          this.renderBundles.set(tile.key, renderBundle);
        }

        tile.setState('ready');
        uploadedBytes += Math.max(renderBundle?.byteLength ?? 0, estimatedUploadBytes);
        uploadedTileCount += 1;
        this.requestRender?.();
      }
      catch (error) {
        this.failTile(tile, 'upload', error);
      }
    }
  }

  private failTile(tile: MvtTile, stage: string, error?: unknown): void {
    logError(this.debugLogging, `Tile ${stage} 失败。`, {
      coordinate: tile.coordinate,
      sourceCoordinate: tile.sourceCoordinate,
      sourceUrl: tile.sourceUrl,
      state: tile.state,
      error,
    });
    this.destroyRenderBundle(tile.key);
    tile.clearPayload();
    this.tileStore.updateTileByteLength(tile, { cpu: 0, gpu: 0 });
    tile.setState('failed');
    this.requestRender?.();
  }

  private releaseEvictedTiles(evictedTiles: readonly MvtTile[]): void {
    for (const tile of evictedTiles) {
      this.inflightLoads.delete(tile.key);
      this.inflightParses.delete(tile.key);
      this.sourceTileCache.release(tile.sourceCoordinate, tile.key);
      this.destroyRenderBundle(tile.key);
    }
  }

  private renderReadyTiles(frameState: PrimitiveFrameState): void {
    const visibleTiles = filterLeafRequestedTiles(this.resolveVisibleTilesForRender());

    let collisionIndex: SymbolCollisionIndex | undefined;
    if (frameState.scene) {
      this.symbolCollisionIndex.beginFrame(frameState.scene);
      collisionIndex = this.symbolCollisionIndex;
    }

    if (!visibleTiles.length) {
      this.renderRecentReadyTiles(frameState, collisionIndex);
      return;
    }

    const renderedTileKeys = new Set<string>();
    const renderedTiles: MvtTile[] = [];
    for (const tile of visibleTiles) {
      const candidateTile = this.resolveRenderableTile(tile);
      if (!candidateTile || renderedTileKeys.has(candidateTile.key)) {
        continue;
      }
      if (
        candidateTile !== tile
        && renderedTiles.some(renderedTile => isDescendantTile(renderedTile, candidateTile))
      ) {
        continue;
      }

      if (!this.renderTile(frameState, candidateTile, tile.coordinate.z, collisionIndex)) {
        continue;
      }

      if (candidateTile !== tile) {
        candidateTile.touch(this.frameNumber, Math.max(candidateTile.priority, tile.priority));
      }
      renderedTiles.push(candidateTile);
      renderedTileKeys.add(candidateTile.key);
    }

    if (!renderedTiles.length) {
      this.renderRecentReadyTiles(frameState, collisionIndex);
    }
  }

  private renderRecentReadyTiles(
    frameState: PrimitiveFrameState,
    collisionIndex: SymbolCollisionIndex | undefined,
  ): void {
    for (const tile of filterLeafRequestedTiles(this.tileStore.getRecentlyRenderedTiles(this.fallbackFrameWindow))) {
      this.renderTile(frameState, tile, tile.coordinate.z, collisionIndex);
    }
  }

  private renderTile(
    frameState: PrimitiveFrameState,
    tile: MvtTile,
    renderZoom: number,
    collisionIndex: SymbolCollisionIndex | undefined,
  ): boolean {
    if (tile.state !== 'ready') {
      return false;
    }

    const renderBundle = this.renderBundles.get(tile.key);
    if (!renderBundle || renderBundle.isDestroyed()) {
      return false;
    }

    renderBundle.update(frameState, renderZoom, collisionIndex);
    tile.markRendered(this.frameNumber);
    return true;
  }

  private resolveRenderableTile(tile: MvtTile): MvtTile | undefined {
    if (tile.state === 'ready' && this.renderBundles.has(tile.key)) {
      return tile;
    }

    return this.tileStore.findReadyAncestor(tile.coordinate);
  }

  private startPendingLoads(tileLoader: TileLoader): void {
    while (this.inflightLoads.size < this.maxConcurrentLoads) {
      const tile = this.tileStore.dequeueLoad();
      if (!tile) {
        return;
      }

      if (tile.state !== 'loading' || this.inflightLoads.has(tile.key)) {
        continue;
      }

      void this.startTileLoad(tile, tileLoader);
    }
  }

  private async startTileLoad(tile: MvtTile, tileLoader: TileLoader): Promise<void> {
    const buildVersion = tile.buildVersion + 1;
    tile.buildVersion = buildVersion;
    tile.setSourceCoordinate(this.resolveSourceCoordinate(tile));
    this.inflightLoads.add(tile.key);

    try {
      const loadResult = await this.sourceTileCache.acquire(tile.sourceCoordinate, tile.key, tileLoader);
      const currentTile = this.tileStore.getTile(tile.key);
      if (!currentTile || currentTile.buildVersion !== buildVersion) {
        this.sourceTileCache.release(tile.sourceCoordinate, tile.key);
        return;
      }

      currentTile.sourceUrl = loadResult.url;
      currentTile.setState('parse-queued');
      this.tileStore.queueParse(currentTile, currentTile.priority);
      this.requestRender?.();
    }
    catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const currentTile = this.tileStore.getTile(tile.key);
      if (!currentTile || currentTile.buildVersion !== buildVersion) {
        return;
      }

      this.sourceTileCache.release(tile.sourceCoordinate, tile.key);
      this.failTile(currentTile, 'load', error);
    }
    finally {
      this.inflightLoads.delete(tile.key);
    }
  }

  private async startTileParse(
    tile: MvtTile,
    styleSet: StyleSet,
    arrayBuffer: ArrayBuffer,
  ): Promise<void> {
    const buildVersion = tile.buildVersion;
    this.inflightParses.add(tile.key);

    try {
      const parsedTileData = await this.parseWorkerClient.parseTile(arrayBuffer, styleSet, tile.coordinate.z);
      const currentTile = this.tileStore.getTile(tile.key);
      if (!currentTile || currentTile.buildVersion !== buildVersion) {
        return;
      }

      currentTile.setParsedTileData(parsedTileData, currentTile.sourceUrl);
      currentTile.setState('parsed');
      this.tileStore.updateTileByteLength(currentTile, {
        cpu: parsedTileData.byteLength,
        gpu: 0,
      });
      this.tileStore.queueUpload(currentTile, currentTile.priority);
      currentTile.setState('upload-queued');
      this.requestRender?.();
    }
    catch (error) {
      const currentTile = this.tileStore.getTile(tile.key);
      if (!currentTile || currentTile.buildVersion !== buildVersion) {
        return;
      }

      this.failTile(currentTile, 'parse', error);
    }
    finally {
      this.inflightParses.delete(tile.key);
      this.sourceTileCache.release(tile.sourceCoordinate, tile.key);
    }
  }

  private resolveActiveTilesForStaleWork(): MvtTile[] {
    if (this.currentVisibleTiles.length) {
      return this.currentVisibleTiles;
    }

    return this.tileStore.getRecentlyTouchedTiles(this.staleFrameWindow);
  }

  private resolveVisibleTilesForRender(): MvtTile[] {
    if (this.currentVisibleTiles.length) {
      return this.currentVisibleTiles;
    }

    return this.tileStore.getRecentlyTouchedTiles(this.fallbackFrameWindow);
  }

  private syncVisibleTiles(): void {
    this.currentVisibleTiles.length = 0;
    if (!this.getVisibleTileCoordinates) {
      return;
    }

    const visibleTileKeys = new Set<string>();
    for (const coordinate of this.getVisibleTileCoordinates()) {
      const priority = Math.max(0, coordinate.z);
      const tile = this.tileStore.touchTile(coordinate, priority);
      if (visibleTileKeys.has(tile.key)) {
        continue;
      }

      visibleTileKeys.add(tile.key);
      this.currentVisibleTiles.push(tile);
      if (tile.state !== 'idle' && tile.state !== 'failed') {
        continue;
      }

      tile.setState('loading');
      this.tileStore.queueLoad(tile, priority);
      this.requestRender?.();
    }
  }

  private resolveSourceCoordinate(tile: MvtTile): MvtTile['sourceCoordinate'] {
    return getSourceTileCoordinate(tile.coordinate, this.styleSet?.source?.maxzoom);
  }
}

function createDefaultTileLoader(styleSet: StyleSet): TileLoader {
  const tileTemplate = styleSet.getSourceTileTemplate();
  if (!tileTemplate) {
    throw new Error('MVT vector source does not define a tile template.');
  }

  return new DefaultTileLoader({
    tileTemplate,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function filterLeafRequestedTiles(tiles: readonly MvtTile[]): MvtTile[] {
  return tiles.filter((tile, tileIndex) => {
    return !tiles.some((otherTile, otherTileIndex) => {
      return tileIndex !== otherTileIndex && isDescendantTile(otherTile, tile);
    });
  });
}

function isDescendantTile(tile: MvtTile, ancestorTile: MvtTile): boolean {
  if (tile.coordinate.z <= ancestorTile.coordinate.z) {
    return false;
  }

  const zoomDelta = tile.coordinate.z - ancestorTile.coordinate.z;
  return Math.floor(tile.coordinate.x / 2 ** zoomDelta) === ancestorTile.coordinate.x
    && Math.floor(tile.coordinate.y / 2 ** zoomDelta) === ancestorTile.coordinate.y;
}
