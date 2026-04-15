export interface RenderObjectPoolOptions<T> {
  create: () => T;
  reset: (obj: T) => void;
  maxSize?: number;
}

export class RenderObjectPool<T> {
  private readonly pool: T[] = [];
  private readonly create: () => T;
  private readonly reset: (obj: T) => void;
  private readonly maxSize: number;

  constructor(options: RenderObjectPoolOptions<T>) {
    this.create = options.create;
    this.reset = options.reset;
    this.maxSize = options.maxSize ?? 100;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      const obj = this.pool.pop()!;
      return obj;
    }

    return this.create();
  }

  release(obj: T): void {
    if (this.pool.length >= this.maxSize) {
      return;
    }

    this.reset(obj);
    this.pool.push(obj);
  }

  size(): number {
    return this.pool.length;
  }

  clear(): void {
    this.pool.length = 0;
  }
}
