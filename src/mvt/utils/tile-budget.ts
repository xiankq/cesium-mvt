import type { CacheEntry } from './tile-cache';
import { TileCache } from './tile-cache';

export interface TileBudgetOptions {
  maxBytes: number;
  maximumCacheOverflowBytes?: number;
}

type OnTileBudgetEvict = (key: string) => void;

interface TileBudgetEntry extends CacheEntry {
  onEvict?: OnTileBudgetEvict;
}

/**
 * 共享瓦片字节预算。
 *
 * 负责把多个缓存源放进同一个 LRU 里，保证 source 缓存和编译结果缓存
 * 参与同一条淘汰链路，而不是各自维护独立预算。
 */
export class TileBudget {
  private readonly entries = new Map<string, TileBudgetEntry>();
  private readonly cache: TileCache;

  constructor(options: TileBudgetOptions) {
    this.cache = new TileCache({
      maxBytes: options.maxBytes,
      maximumCacheOverflowBytes: options.maximumCacheOverflowBytes,
    });
  }

  beginFrame(): number {
    return this.cache.beginFrame();
  }

  add(
    key: string,
    entry: CacheEntry,
    onEvict?: OnTileBudgetEvict,
    isVisible?: boolean,
  ): void {
    const normalizedEntry = {
      ...entry,
      isVisible: isVisible ?? entry.isVisible ?? false,
      // 0 字节条目也要占用最小预算单位，否则空瓦片不会进入淘汰链路。
      byteLength: Math.max(entry.byteLength, 1),
    };

    this.delete(key);

    this.entries.set(key, {
      ...normalizedEntry,
      onEvict,
    });

    const evictedEntries = this.cache.add(key, normalizedEntry);
    for (const evictedEntry of evictedEntries) {
      const evictedBudgetEntry = this.entries.get(evictedEntry.key);
      this.entries.delete(evictedEntry.key);
      evictedBudgetEntry?.onEvict?.(evictedEntry.key);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  touch(key: string): void {
    this.cache.touch(key);
  }

  setVisibility(key: string, isVisible: boolean): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.isVisible = isVisible;
    }

    this.cache.setVisibility(key, isVisible);
  }

  delete(key: string): void {
    this.entries.delete(key);
    this.cache.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.cache.clear();
  }

  getCurrentBytes(): number {
    return this.cache.getCurrentBytes();
  }

  getMaxBytes(): number {
    return this.cache.getMaxBytes();
  }

  getMaximumCacheOverflowBytes(): number {
    return this.cache.getMaximumCacheOverflowBytes();
  }
}
