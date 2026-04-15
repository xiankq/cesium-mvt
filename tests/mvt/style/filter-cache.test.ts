import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { FilterCache } from '@/mvt/style/filter-cache';

describe('filter-cache', () => {
  describe('filterCache', () => {
    it('should cache compiled filters', () => {
      const cache = new FilterCache();

      const filter1: FilterSpecification = ['==', 'type', 'road'];
      const filter2: FilterSpecification = ['==', 'type', 'road'];

      const compiled1 = cache.getOrCreate(filter1);
      const compiled2 = cache.getOrCreate(filter2);

      expect(compiled1).toBe(compiled2);
    });

    it('should return different compiled filters for different inputs', () => {
      const cache = new FilterCache();

      const filter1: FilterSpecification = ['==', 'type', 'road'];
      const filter2: FilterSpecification = ['==', 'type', 'building'];

      const compiled1 = cache.getOrCreate(filter1);
      const compiled2 = cache.getOrCreate(filter2);

      expect(compiled1).not.toBe(compiled2);
    });

    it('should limit cache size', () => {
      const cache = new FilterCache({ maxSize: 2 });

      const filter1: FilterSpecification = ['==', 'type', 'road'];
      const filter2: FilterSpecification = ['==', 'type', 'building'];
      const filter3: FilterSpecification = ['==', 'type', 'water'];

      cache.getOrCreate(filter1);
      cache.getOrCreate(filter2);
      cache.getOrCreate(filter3);

      expect(cache.size()).toBe(2);
    });

    it('should clear cache', () => {
      const cache = new FilterCache();

      const filter: FilterSpecification = ['==', 'type', 'road'];
      cache.getOrCreate(filter);

      cache.clear();

      expect(cache.size()).toBe(0);
    });
  });
});
