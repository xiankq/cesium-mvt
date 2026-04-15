import type { ParsedTileResult } from '../bucket';
import { TileBudget } from '../utils/tile-budget';

const DEFAULT_CACHE_SIZE = 256 * 1024 * 1024;

export interface TileCacheEntry {
  key: string;
  tile: ParsedTileResult;
  byteLength: number;
}

export interface TileCacheManagerMetrics {
  currentBytes: number;
  entryCount: number;
  evictCount: number;
  hitCount: number;
  missCount: number;
  maxBytes: number;
  maximumCacheOverflowBytes: number;
}

export type OnEvictCallback = (key: string, tile: ParsedTileResult) => void;

export interface TileCacheManagerOptions {
  maxBytes?: number;
  maximumCacheOverflowBytes?: number;
  readyTileBudget?: TileBudget;
}

export class TileCacheManager {
  private readonly bucketTileBudget: TileBudget;
  private readonly bucketTiles = new Map<string, ParsedTileResult>();
  private readonly pendingRequests = new Map<string, Promise<ParsedTileResult | undefined>>();
  private onEvict?: OnEvictCallback;
  private readonly metrics: Pick<TileCacheManagerMetrics, 'entryCount' | 'evictCount' | 'hitCount' | 'missCount'> = {
    entryCount: 0,
    evictCount: 0,
    hitCount: 0,
    missCount: 0,
  };

  constructor(options: TileCacheManagerOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_CACHE_SIZE;
    this.bucketTileBudget = options.readyTileBudget ?? new TileBudget({
      maxBytes,
      maximumCacheOverflowBytes: options.maximumCacheOverflowBytes,
    });
  }

  beginFrame(): number {
    return this.bucketTileBudget.beginFrame();
  }

  setOnEvict(callback: OnEvictCallback): void {
    this.onEvict = callback;
  }

  get(key: string): ParsedTileResult | undefined {
    const cached = this.bucketTiles.get(key);
    if (cached) {
      this.metrics.hitCount += 1;
      this.bucketTileBudget.touch(key);
      this.metrics.entryCount = this.bucketTiles.size;
      return cached;
    }
    this.metrics.missCount += 1;
    this.metrics.entryCount = this.bucketTiles.size;
    return cached;
  }

  set(key: string, tile: ParsedTileResult): void {
    this.bucketTiles.set(key, tile);
    this.bucketTileBudget.add(key, {
      key,
      isVisible: true,
      byteLength: tile.byteLength,
    }, (evictedKey) => {
      const evictedTile = this.bucketTiles.get(evictedKey);
      if (!evictedTile) {
        return;
      }

      this.bucketTiles.delete(evictedKey);
      this.metrics.evictCount += 1;
      this.metrics.entryCount = this.bucketTiles.size;
      try {
        this.onEvict?.(evictedKey, evictedTile);
      }
      catch (err) {
        console.warn('[TileCacheManager] onEvict callback failed:', err);
      }
    });
  }

  setVisibility(key: string, isVisible: boolean): void {
    this.bucketTileBudget.setVisibility(key, isVisible);
  }

  setPending(key: string, promise: Promise<ParsedTileResult | undefined>): void {
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

  getMetrics(): TileCacheManagerMetrics {
    this.metrics.entryCount = this.bucketTiles.size;
    return {
      ...this.metrics,
      currentBytes: this.bucketTileBudget.getCurrentBytes(),
      maxBytes: this.bucketTileBudget.getMaxBytes(),
      maximumCacheOverflowBytes: this.bucketTileBudget.getMaximumCacheOverflowBytes(),
    };
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

    for (const key of Array.from(this.bucketTiles.keys())) {
      this.bucketTileBudget.delete(key);
    }
    this.bucketTiles.clear();
    this.pendingRequests.clear();
  }

  destroy(): void {
    // 销毁时不触发业务回调，避免在对象生命周期结束时产生意外副作用
    this.clear(false);
  }
}
