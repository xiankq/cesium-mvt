export interface TileCacheOptions {
  maxBytes: number;
}

export interface CacheEntry {
  byteLength: number;
  [key: string]: any;
}

export function calculateDynamicCacheSize(viewportSize: {
  height: number;
  tileSize: number;
  width: number;
}): number {
  // 计算视口内需要的瓦片数量（宽度和高度各加1作为缓冲）
  const widthInTiles = Math.ceil(viewportSize.width / viewportSize.tileSize) + 1;
  const heightInTiles = Math.ceil(viewportSize.height / viewportSize.tileSize) + 1;
  const approxTilesInView = widthInTiles * heightInTiles;

  // 考虑常见的缩放范围层级数，缓存多个层级的瓦片以支持快速缩放
  const commonZoomRange = 5;
  const viewDependentMaxSize = Math.floor(approxTilesInView * commonZoomRange);

  // 单个瓦片估算为 100KB（包括矢量数据和元数据）
  return viewDependentMaxSize * 100 * 1024;
}

interface CacheNode {
  entry: CacheEntry;
  key: string;
  next: CacheNode | null;
  prev: CacheNode | null;
}

export class TileCache {
  private maxBytes: number;
  private currentBytes: number = 0;
  private cache: Map<string, CacheNode> = new Map();
  private head: CacheNode | null = null;
  private tail: CacheNode | null = null;

  constructor(options: TileCacheOptions) {
    this.maxBytes = options.maxBytes;
  }

  add(key: string, entry: CacheEntry): void {
    while (this.currentBytes + entry.byteLength > this.maxBytes && this.head) {
      const oldestKey = this.head.key;
      const oldestNode = this.head;
      this.head = this.head.next;
      if (this.head) {
        this.head.prev = null;
      }
      else {
        this.tail = null;
      }
      this.cache.delete(oldestKey);
      this.currentBytes -= oldestNode.entry.byteLength;
    }

    const newNode: CacheNode = {
      entry,
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
    this.currentBytes += entry.byteLength;
  }

  has(key: string): boolean {
    return this.cache.has(key);
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

    // 从当前位置移除节点
    if (node.prev) {
      node.prev.next = node.next;
    }
    else {
      this.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }

    // 将节点移到尾部
    node.prev = this.tail;
    node.next = null;
    if (this.tail) {
      this.tail.next = node;
    }
    this.tail = node;
  }

  getCurrentBytes(): number {
    return this.currentBytes;
  }
}
