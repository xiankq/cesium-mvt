export class TileCache<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get size() {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined)
      return undefined;

    this.entries.delete(key);
    this.entries.set(key, value);

    return value;
  }

  set(
    key: K,
    value: V,
    options?: {
      skipEviction?: (key: K, value: V) => boolean;
    },
  ): Array<{ key: K; value: V }> {
    const evicted: Array<{ key: K; value: V }> = [];

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, value);
    evicted.push(...this.trim(options?.skipEviction));

    return evicted;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }

  values(): IterableIterator<V> {
    return this.entries.values();
  }

  trim(skipEviction?: (key: K, value: V) => boolean): Array<{ key: K; value: V }> {
    const evicted: Array<{ key: K; value: V }> = [];

    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined)
        break;

      if (skipEviction?.(oldest, this.entries.get(oldest)!)) {
        break;
      }

      const value = this.entries.get(oldest)!;
      this.entries.delete(oldest);
      evicted.push({ key: oldest, value });
    }

    return evicted;
  }
}
