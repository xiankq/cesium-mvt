export interface TileCacheOptions {
  maxBytes: number;
  maximumCacheOverflowBytes?: number;
}

export interface CacheEntry {
  byteLength: number;
  isVisible?: boolean;
  [key: string]: any;
}

export interface EvictedCacheEntry {
  entry: CacheEntry;
  key: string;
}

interface CacheNode {
  entry: CacheEntry;
  key: string;
  next: CacheNode | null;
  prev: CacheNode | null;
}

export class TileCache {
  private maxBytes: number;
  private maximumCacheOverflowBytes: number;
  private currentBytes: number = 0;
  private cache: Map<string, CacheNode> = new Map();
  private head: CacheNode | null = null;
  private tail: CacheNode | null = null;

  constructor(options: TileCacheOptions) {
    this.maxBytes = options.maxBytes;
    this.maximumCacheOverflowBytes = options.maximumCacheOverflowBytes ?? 0;
  }

  add(key: string, entry: CacheEntry): EvictedCacheEntry[] {
    const evictedEntries: EvictedCacheEntry[] = [];
    const normalizedEntry: CacheEntry = {
      ...entry,
      isVisible: entry.isVisible ?? false,
    };
    this.delete(key);

    const hardLimit = this.maxBytes + this.maximumCacheOverflowBytes;

    // 先把明显超出硬上限的部分清掉，确保缓存不会无限膨胀。
    while (this.currentBytes + normalizedEntry.byteLength > hardLimit) {
      const evictionCandidate = this.findEvictionCandidate();
      if (!evictionCandidate) {
        break;
      }

      this.detachNode(evictionCandidate);
      this.cache.delete(evictionCandidate.key);
      this.currentBytes -= evictionCandidate.entry.byteLength;
      evictedEntries.push({
        entry: evictionCandidate.entry,
        key: evictionCandidate.key,
      });
    }

    // 再尽量回到目标预算；这里优先移除不可见条目，
    // 让可见瓦片可以暂时占用 overflow 预算。
    while (this.currentBytes + normalizedEntry.byteLength > this.maxBytes) {
      const evictionCandidate = this.findInvisibleEvictionCandidate();
      if (!evictionCandidate) {
        break;
      }

      this.detachNode(evictionCandidate);
      this.cache.delete(evictionCandidate.key);
      this.currentBytes -= evictionCandidate.entry.byteLength;
      evictedEntries.push({
        entry: evictionCandidate.entry,
        key: evictionCandidate.key,
      });
    }

    const newNode: CacheNode = {
      entry: normalizedEntry,
      key,
      next: null,
      prev: this.tail,
    };

    if (this.tail) {
      this.tail.next = newNode;
    }
    else {
      this.head = newNode;
    }
    this.tail = newNode;

    this.cache.set(key, newNode);
    this.currentBytes += normalizedEntry.byteLength;
    return evictedEntries;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): CacheEntry | undefined {
    const node = this.cache.get(key);
    if (!node) {
      return undefined;
    }

    this.detachNode(node);
    this.cache.delete(key);
    this.currentBytes -= node.entry.byteLength;
    return node.entry;
  }

  setVisibility(key: string, isVisible: boolean): void {
    const node = this.cache.get(key);
    if (!node) {
      return;
    }

    node.entry.isVisible = isVisible;
  }

  clear(): EvictedCacheEntry[] {
    const evictedEntries: EvictedCacheEntry[] = [];
    for (const [key, node] of this.cache) {
      evictedEntries.push({
        entry: node.entry,
        key,
      });
    }

    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentBytes = 0;
    return evictedEntries;
  }

  touch(key: string): void {
    const node = this.cache.get(key);
    if (!node) {
      return;
    }

    // 如果节点已经在尾部，无需移动
    if (node === this.tail) {
      return;
    }

    this.detachNode(node);
    node.prev = this.tail;
    node.next = null;
    if (this.tail) {
      this.tail.next = node;
    }
    else {
      this.head = node;
    }
    this.tail = node;
  }

  getCurrentBytes(): number {
    return this.currentBytes;
  }

  private detachNode(node: CacheNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    }
    else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    }
    else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private findEvictionCandidate(): CacheNode | undefined {
    const invisibleCandidate = this.findInvisibleEvictionCandidate();
    if (invisibleCandidate) {
      return invisibleCandidate;
    }

    return this.head ?? undefined;
  }

  private findInvisibleEvictionCandidate(): CacheNode | undefined {
    let node = this.head;
    while (node) {
      if (node.entry.isVisible !== true) {
        return node;
      }

      node = node.next;
    }

    return undefined;
  }
}
