export interface TileCacheOptions {
  maxBytes: number;
}

export interface CacheEntry {
  byteLength: number;
  [key: string]: any;
}

export function calculateDynamicCacheSize(viewportSize: {
  width: number;
  height: number;
  tileSize: number;
}): number {
  const widthInTiles = Math.ceil(viewportSize.width / viewportSize.tileSize) + 1;
  const heightInTiles = Math.ceil(viewportSize.height / viewportSize.tileSize) + 1;
  const approxTilesInView = widthInTiles * heightInTiles;
  const commonZoomRange = 5;
  const viewDependentMaxSize = Math.floor(approxTilesInView * commonZoomRange);

  return viewDependentMaxSize * 100 * 1024;
}

export class TileCache {
  private maxBytes: number;
  private currentBytes: number = 0;
  private cache: Map<string, CacheEntry> = new Map();
  private order: string[] = [];

  constructor(options: TileCacheOptions) {
    this.maxBytes = options.maxBytes;
  }

  add(key: string, entry: CacheEntry): void {
    while (this.currentBytes + entry.byteLength > this.maxBytes && this.order.length > 0) {
      const oldestKey = this.order.shift()!;
      const oldestEntry = this.cache.get(oldestKey)!;
      this.cache.delete(oldestKey);
      this.currentBytes -= oldestEntry.byteLength;
    }

    this.cache.set(key, entry);
    this.order.push(key);
    this.currentBytes += entry.byteLength;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  touch(key: string): void {
    const index = this.order.indexOf(key);
    if (index !== -1) {
      this.order.splice(index, 1);
      this.order.push(key);
    }
  }

  getCurrentBytes(): number {
    return this.currentBytes;
  }
}
