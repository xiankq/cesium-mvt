import type { ParsedTileResult } from '../bucket';
import { TileBudget } from '../utils/tile-budget';

const DEFAULT_CACHE_SIZE = 256 * 1024 * 1024;

export interface TileCacheEntry {
  key: string;
  tile: ParsedTileResult;
  byteLength: number;
}

export type OnEvictCallback = (key: string, tile: ParsedTileResult) => void;

export interface TileCacheManagerOptions {
  maxBytes?: number;
  readyTileBudget?: TileBudget;
}

export class TileCacheManager {
  private readonly bucketTileBudget: TileBudget;
  private readonly bucketTiles = new Map<string, ParsedTileResult>();
  private readonly pendingRequests = new Map<string, Promise<ParsedTileResult | undefined>>();
  private onEvict?: OnEvictCallback;

  constructor(options: number | TileCacheManagerOptions = DEFAULT_CACHE_SIZE) {
    const maxBytes = typeof options === 'number'
      ? options
      : options.maxBytes ?? DEFAULT_CACHE_SIZE;
    this.bucketTileBudget = typeof options === 'number'
      ? new TileBudget({ maxBytes })
      : options.readyTileBudget ?? new TileBudget({ maxBytes });
  }

  setOnEvict(callback: OnEvictCallback): void {
    this.onEvict = callback;
  }

  get(key: string): ParsedTileResult | undefined {
    const cached = this.bucketTiles.get(key);
    if (cached) {
      this.bucketTileBudget.touch(key);
    }
    return cached;
  }

  getPending(key: string): Promise<ParsedTileResult | undefined> | undefined {
    return this.pendingRequests.get(key);
  }

  set(key: string, tile: ParsedTileResult): void {
    this.bucketTiles.set(key, tile);
    this.bucketTileBudget.add(key, {
      key,
      byteLength: tile.byteLength,
    }, (evictedKey) => {
      const evictedTile = this.bucketTiles.get(evictedKey);
      if (!evictedTile) {
        return;
      }

      this.bucketTiles.delete(evictedKey);
      try {
        this.onEvict?.(evictedKey, evictedTile);
      }
      catch (err) {
        console.warn('[TileCacheManager] onEvict callback failed:', err);
      }
    });
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
