import type { VisibilityAwareCacheOptions } from '@/mvt/utils/visibility-aware-cache';
import { describe, expect, it } from 'vitest';
import { VisibilityAwareCache } from '@/mvt/utils/visibility-aware-cache';

describe('visibility-aware-cache', () => {
  describe('visibilityAwareCache', () => {
    it('should prioritize visible tiles over invisible tiles', () => {
      const options: VisibilityAwareCacheOptions = {
        maxBytes: 80,
      };

      const cache = new VisibilityAwareCache<string, { byteLength: number }>(options);

      cache.set('visible1', { byteLength: 30 }, true);
      cache.set('invisible1', { byteLength: 30 }, false);
      cache.set('visible2', { byteLength: 30 }, true);

      expect(cache.has('visible1')).toBe(true);
      expect(cache.has('visible2')).toBe(true);
      expect(cache.has('invisible1')).toBe(false);
    });

    it('should evict oldest invisible tiles first', () => {
      const options: VisibilityAwareCacheOptions = {
        maxBytes: 80,
      };

      const cache = new VisibilityAwareCache<string, { byteLength: number }>(options);

      cache.set('invisible1', { byteLength: 30 }, false);
      cache.set('invisible2', { byteLength: 30 }, false);
      cache.set('visible1', { byteLength: 30 }, true);

      expect(cache.has('invisible1')).toBe(false);
      expect(cache.has('invisible2')).toBe(true);
      expect(cache.has('visible1')).toBe(true);
    });

    it('should update visibility status', () => {
      const options: VisibilityAwareCacheOptions = {
        maxBytes: 80,
      };

      const cache = new VisibilityAwareCache<string, { byteLength: number }>(options);

      cache.set('tile1', { byteLength: 30 }, false);
      cache.set('tile2', { byteLength: 30 }, false);
      cache.updateVisibility('tile1', true);
      cache.set('tile3', { byteLength: 30 }, true);

      expect(cache.has('tile1')).toBe(true);
      expect(cache.has('tile2')).toBe(false);
      expect(cache.has('tile3')).toBe(true);
    });
  });
});
