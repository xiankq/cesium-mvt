export class TileCache<K, V> {
  private readonly entries = new Map<K, V>()
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get size() {
    return this.entries.size
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined

    this.entries.delete(key)
    this.entries.set(key, value)

    return value
  }

  set(key: K, value: V): Array<{ key: K; value: V }> {
    const evicted: Array<{ key: K; value: V }> = []

    if (this.entries.has(key)) {
      this.entries.delete(key)
    }

    this.entries.set(key, value)
    evicted.push(...this.trim())

    return evicted
  }

  has(key: K): boolean {
    return this.entries.has(key)
  }

  clear(): void {
    this.entries.clear()
  }

  values(): IterableIterator<V> {
    return this.entries.values()
  }

  private trim(): Array<{ key: K; value: V }> {
    const evicted: Array<{ key: K; value: V }> = []

    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value as K | undefined
      if (oldestKey === undefined) return evicted

      const oldestValue = this.entries.get(oldestKey)
      if (oldestValue === undefined) {
        this.entries.delete(oldestKey)
        continue
      }

      evicted.push({ key: oldestKey, value: oldestValue })
      this.entries.delete(oldestKey)
    }

    return evicted
  }
}
