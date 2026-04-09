import type { TileCoordinate } from '../types';
import { MvtTile } from './tile';
import { TileCache } from './tile-cache';
import { createTileKey } from './tile-key';
import { TileQueue } from './tile-queue';

export interface TileStoreOptions {
  maxCpuCacheBytes?: number;
  maxGpuCacheBytes?: number;
  protectedFrames?: number;
}

export class TileStore {
  private currentFrameNumber = 0;
  private readonly cpuCache: TileCache;
  private readonly gpuCache: TileCache;
  private readonly loadQueue = new TileQueue();
  private readonly parseQueue = new TileQueue();
  private readonly tiles = new Map<string, MvtTile>();
  private readonly uploadQueue = new TileQueue();

  constructor(options: TileStoreOptions = {}) {
    const protectedFrames = options.protectedFrames ?? 2;
    this.cpuCache = new TileCache({
      byteLengthSelector: tile => tile.cpuByteLength,
      maxByteLength: options.maxCpuCacheBytes ?? 32 * 1024 * 1024,
      protectedFrames,
    });
    this.gpuCache = new TileCache({
      byteLengthSelector: tile => tile.gpuByteLength,
      maxByteLength: options.maxGpuCacheBytes ?? 64 * 1024 * 1024,
      protectedFrames,
    });
  }

  get cpuCacheBytes(): number {
    return this.cpuCache.totalByteLength;
  }

  get frameNumber(): number {
    return this.currentFrameNumber;
  }

  get gpuCacheBytes(): number {
    return this.gpuCache.totalByteLength;
  }

  get loadingQueueSize(): number {
    return this.loadQueue.size;
  }

  get parseQueueSize(): number {
    return this.parseQueue.size;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  get uploadQueueSize(): number {
    return this.uploadQueue.size;
  }

  beginFrame(frameNumber: number): void {
    this.currentFrameNumber = frameNumber;
  }

  clear(): void {
    this.cpuCache.clear();
    this.gpuCache.clear();
    this.loadQueue.clear();
    this.parseQueue.clear();
    this.uploadQueue.clear();
    this.tiles.clear();
  }

  dequeueLoad(): MvtTile | undefined {
    return this.loadQueue.popNext();
  }

  dequeueParse(): MvtTile | undefined {
    return this.parseQueue.popNext();
  }

  dequeueUpload(): MvtTile | undefined {
    return this.uploadQueue.popNext();
  }

  getTile(tileKey: string): MvtTile | undefined {
    return this.tiles.get(tileKey);
  }

  getTiles(): MvtTile[] {
    return [...this.tiles.values()];
  }

  findReadyAncestor(coordinate: TileCoordinate): MvtTile | undefined {
    let { x, y, z } = coordinate;
    while (z > 0) {
      x = Math.floor(x / 2);
      y = Math.floor(y / 2);
      z -= 1;

      const ancestorTile = this.tiles.get(createTileKey({ x, y, z }));
      if (ancestorTile?.state === 'ready') {
        return ancestorTile;
      }
    }

    return undefined;
  }

  getRecentlyTouchedTiles(maxFrameAge = 1): MvtTile[] {
    return this.getRecentTiles(tile => tile.lastTouchedFrame, maxFrameAge);
  }

  getRecentlyRenderedTiles(maxFrameAge = 1): MvtTile[] {
    return this.getRecentTiles(tile => tile.lastRenderedFrame, maxFrameAge);
  }

  queueLoad(tileOrKey: MvtTile | string, priority: number): MvtTile {
    const tile = resolveTile(this.tiles, tileOrKey);
    this.loadQueue.upsert(tile, priority);
    return tile;
  }

  queueParse(tileOrKey: MvtTile | string, priority: number): MvtTile {
    const tile = resolveTile(this.tiles, tileOrKey);
    this.parseQueue.upsert(tile, priority);
    return tile;
  }

  queueUpload(tileOrKey: MvtTile | string, priority: number): MvtTile {
    const tile = resolveTile(this.tiles, tileOrKey);
    this.uploadQueue.upsert(tile, priority);
    return tile;
  }

  removeFromQueues(tileKey: string): void {
    this.loadQueue.remove(tileKey);
    this.parseQueue.remove(tileKey);
    this.uploadQueue.remove(tileKey);
  }

  touchTile(coordinate: TileCoordinate, priority = 0): MvtTile {
    const tileKey = createTileKey(coordinate);
    let tile = this.tiles.get(tileKey);
    if (!tile) {
      tile = new MvtTile(coordinate);
      this.tiles.set(tileKey, tile);
    }

    tile.touch(this.currentFrameNumber, priority);
    return tile;
  }

  updateTileByteLength(
    tileOrKey: MvtTile | string,
    byteLength: { cpu?: number; gpu?: number },
  ): MvtTile {
    const tile = resolveTile(this.tiles, tileOrKey);
    this.cpuCache.delete(tile.key);
    this.gpuCache.delete(tile.key);
    tile.setByteLength(byteLength);
    this.cpuCache.track(tile);
    this.gpuCache.track(tile);
    return tile;
  }

  evictToBudgets(): MvtTile[] {
    const evictedTileMap = new Map<string, MvtTile>();

    for (const tile of this.cpuCache.evict(this.currentFrameNumber)) {
      evictedTileMap.set(tile.key, tile);
    }
    for (const tile of this.gpuCache.evict(this.currentFrameNumber)) {
      evictedTileMap.set(tile.key, tile);
    }

    for (const tile of evictedTileMap.values()) {
      this.cpuCache.delete(tile.key);
      this.gpuCache.delete(tile.key);
      tile.setState('evicted');
      tile.clearPayload();
      tile.setByteLength({ cpu: 0, gpu: 0 });
      this.loadQueue.remove(tile.key);
      this.parseQueue.remove(tile.key);
      this.uploadQueue.remove(tile.key);
      this.tiles.delete(tile.key);
    }

    return [...evictedTileMap.values()];
  }

  private getRecentTiles(
    frameSelector: (tile: MvtTile) => number,
    maxFrameAge: number,
  ): MvtTile[] {
    const normalizedFrameAge = Math.max(0, maxFrameAge);
    return [...this.tiles.values()]
      .filter((tile) => {
        const frameNumber = frameSelector(tile);
        return frameNumber >= 0
          && this.currentFrameNumber - frameNumber <= normalizedFrameAge;
      })
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        return right.coordinate.z - left.coordinate.z;
      });
  }
}

function resolveTile(tiles: Map<string, MvtTile>, tileOrKey: MvtTile | string): MvtTile {
  if (typeof tileOrKey !== 'string') {
    return tileOrKey;
  }

  const tile = tiles.get(tileOrKey);
  if (!tile) {
    throw new Error(`Tile "${tileOrKey}" does not exist.`);
  }
  return tile;
}
