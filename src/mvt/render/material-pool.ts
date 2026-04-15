export interface MaterialPoolOptions {
  maxMaterials?: number;
}

interface MaterialEntry<T> {
  material: T;
  referenceCount: number;
}

export class MaterialPool<T = unknown> {
  private readonly materials = new Map<string, MaterialEntry<T>>();
  private readonly maxMaterials: number;

  constructor(options: MaterialPoolOptions = {}) {
    this.maxMaterials = options.maxMaterials ?? 100;
  }

  acquire(key: string, createMaterial: () => T): T {
    const entry = this.materials.get(key);

    if (entry) {
      entry.referenceCount += 1;
      return entry.material;
    }

    const material = createMaterial();
    this.materials.set(key, {
      material,
      referenceCount: 1,
    });

    this.evictIfNeeded();

    return material;
  }

  release(key: string): void {
    const entry = this.materials.get(key);

    if (!entry) {
      return;
    }

    entry.referenceCount -= 1;

    if (entry.referenceCount <= 0) {
      this.materials.delete(key);
    }
  }

  getReferenceCount(key: string): number {
    const entry = this.materials.get(key);
    return entry?.referenceCount ?? 0;
  }

  has(key: string): boolean {
    return this.materials.has(key);
  }

  clear(): void {
    this.materials.clear();
  }

  size(): number {
    return this.materials.size;
  }

  private evictIfNeeded(): void {
    if (this.materials.size <= this.maxMaterials) {
      return;
    }

    let lowestRefCount = Infinity;
    let keyToEvict: string | undefined;

    for (const [key, entry] of this.materials) {
      if (entry.referenceCount < lowestRefCount) {
        lowestRefCount = entry.referenceCount;
        keyToEvict = key;
      }
    }

    if (keyToEvict !== undefined) {
      this.materials.delete(keyToEvict);
    }
  }
}
