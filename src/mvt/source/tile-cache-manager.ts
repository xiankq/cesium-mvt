import type { ParsedTileResult } from '../bucket';
import { TileCache } from '../utils/tile-cache';

const DEFAULT_CACHE_SIZE = 64 * 1024 * 1024;

export interface TileCacheEntry {
  key: string;
  tile: ParsedTileResult;
  byteLength: number;
}

export class TileCacheManager {
  private readonly bucketTileCache: TileCache;
  private readonly bucketTiles = new Map<string, ParsedTileResult>();
  private readonly pendingRequests = new Map<string, Promise<ParsedTileResult>>();

  constructor(maxBytes: number = DEFAULT_CACHE_SIZE) {
    this.bucketTileCache = new TileCache({ maxBytes });
  }

  get(key: string): ParsedTileResult | undefined {
    const cached = this.bucketTiles.get(key);
    if (cached) {
      this.bucketTileCache.touch(key);
    }
    return cached;
  }

  getPending(key: string): Promise<ParsedTileResult> | undefined {
    return this.pendingRequests.get(key);
  }

  set(key: string, tile: ParsedTileResult): void {
    this.bucketTiles.set(key, tile);
    this.bucketTileCache.add(key, {
      key,
      byteLength: tile.byteLength,
    });
  }

  setPending(key: string, promise: Promise<ParsedTileResult>): void {
    this.pendingRequests.set(key, promise);
  }

  deletePending(key: string): void {
    this.pendingRequests.delete(key);
  }

  has(key: string): boolean {
    return this.bucketTiles.has(key);
  }

  hasPending(key: string): boolean {
    return this.pendingRequests.has(key);
  }

  clear(): void {
    this.bucketTiles.clear();
    this.bucketTileCache.clear();
    this.pendingRequests.clear();
  }

  destroy(): void {
    this.clear();
  }
}
