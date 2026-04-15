import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureFilterContext } from './filter-adapter';
import { createFeatureFilter } from './filter-adapter';

export interface FilterCacheOptions {
  maxSize?: number;
}

export class FilterCache {
  private readonly cache = new Map<string, (context: FeatureFilterContext) => boolean>();
  private readonly maxSize: number;

  constructor(options: FilterCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
  }

  getOrCreate(filter: FilterSpecification | null | undefined): (context: FeatureFilterContext) => boolean {
    if (filter === null || filter === undefined) {
      return () => true;
    }

    if (filter === true) {
      return () => true;
    }

    if (filter === false) {
      return () => false;
    }

    const key = this.createKey(filter);

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const compiled = createFeatureFilter(filter);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, compiled);
    return compiled;
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  private createKey(filter: FilterSpecification): string {
    return JSON.stringify(filter);
  }
}
