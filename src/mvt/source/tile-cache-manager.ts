import type { ParsedTileResult } from '../bucket';
import { TileCache } from '../utils/tile-cache';

const DEFAULT_CACHE_SIZE = 256 * 1024 * 1024;

export interface TileCacheEntry {
  key: string;
  tile: ParsedTileResult;
  byteLength: number;
}

export type OnEvictCallback = (key: string, tile: ParsedTileResult) => void;

export class TileCacheManager {
  private readonly bucketTileCache: TileCache;
  private readonly bucketTiles = new Map<string, ParsedTileResult>();
  private readonly pendingRequests = new Map<string, Promise<ParsedTileResult>>();
  private onEvict?: OnEvictCallback;

  constructor(maxBytes: number = DEFAULT_CACHE_SIZE) {
    this.bucketTileCache = new TileCache({ maxBytes });
  }

  setOnEvict(callback: OnEvictCallback): void {
    this.onEvict = callback;
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
    const evictedEntries = this.bucketTileCache.add(key, {
      key,
      byteLength: tile.byteLength,
    });

    this.bucketTiles.set(key, tile);

    for (const evicted of evictedEntries) {
      const evictedTile = this.bucketTiles.get(evicted.key);
      if (evictedTile) {
        this.bucketTiles.delete(evicted.key);
        try {
          this.onEvict?.(evicted.key, evictedTile);
        }
        catch (err) {
          console.warn('[TileCacheManager] onEvict callback failed:', err);
        }
      }
    }
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

  /**
   * 清空缓存
   * @param notifyEvict - 是否触发驱逐回调（默认false，仅在容量不足驱逐时触发）
   */
  clear(notifyEvict = false): void {
    if (notifyEvict) {
      for (const [key, tile] of this.bucketTiles) {
        try {
          this.onEvict?.(key, tile);
        }
        catch (err) {
          console.warn('[TileCacheManager] onEvict callback failed during clear:', err);
        }
      }
    }
    this.bucketTiles.clear();
    this.bucketTileCache.clear();
    this.pendingRequests.clear();
  }

  destroy(): void {
    // 销毁时不触发业务回调，避免在对象生命周期结束时产生意外副作用
    this.clear(false);
  }
}
