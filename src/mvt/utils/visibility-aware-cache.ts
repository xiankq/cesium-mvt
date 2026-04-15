export interface VisibilityAwareCacheOptions {
  maxBytes: number;
}

interface CacheEntry<T> {
  byteLength: number;
  isVisible: boolean;
  value: T;
}

export class VisibilityAwareCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly maxBytes: number;
  private currentBytes = 0;

  constructor(options: VisibilityAwareCacheOptions) {
    this.maxBytes = options.maxBytes;
  }

  set(key: K, value: V & { byteLength: number }, isVisible: boolean): void {
    const entry: CacheEntry<V> = {
      byteLength: value.byteLength,
      isVisible,
      value,
    };

    if (this.entries.has(key)) {
      const oldEntry = this.entries.get(key)!;
      this.currentBytes -= oldEntry.byteLength;
      this.entries.delete(key);
    }

    while (this.currentBytes + entry.byteLength > this.maxBytes) {
      const keyToEvict = this.findKeyToEvict();
      if (keyToEvict === undefined || keyToEvict === key) {
        break;
      }

      const evictedEntry = this.entries.get(keyToEvict)!;
      this.currentBytes -= evictedEntry.byteLength;
      this.entries.delete(keyToEvict);
    }

    if (this.currentBytes + entry.byteLength <= this.maxBytes) {
      this.entries.set(key, entry);
      this.currentBytes += entry.byteLength;
    }
  }

  get(key: K): V | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  updateVisibility(key: K, isVisible: boolean): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.isVisible = isVisible;
    }
  }

  delete(key: K): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.currentBytes -= entry.byteLength;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }

  private findKeyToEvict(): K | undefined {
    let oldestInvisibleKey: K | undefined;
    let oldestInvisibleTime = Infinity;

    let oldestVisibleKey: K | undefined;
    let oldestVisibleTime = Infinity;

    let index = 0;
    for (const [key, entry] of this.entries) {
      const time = index;

      if (!entry.isVisible) {
        if (time < oldestInvisibleTime) {
          oldestInvisibleKey = key;
          oldestInvisibleTime = time;
        }
      }
      else {
        if (time < oldestVisibleTime) {
          oldestVisibleKey = key;
          oldestVisibleTime = time;
        }
      }

      index++;
    }

    return oldestInvisibleKey ?? oldestVisibleKey;
  }
}
