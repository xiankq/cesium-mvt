import type { TileLifecycleOptions } from '@/mvt/source/tile-lifecycle';
import { describe, expect, it } from 'vitest';
import {
  computeTileLifecycle,

} from '@/mvt/source/tile-lifecycle';

describe('tile-lifecycle', () => {
  describe('computeTileLifecycle', () => {
    it('returns request when tile is not cached, not pending, and within zoom range', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        isVisible: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('request');
    });

    it('returns skip when tile is already cached', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: true,
        isPending: false,
        isVisible: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('show');
    });

    it('returns wait when tile is pending', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: false,
        isPending: true,
        isVisible: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('wait');
    });

    it('returns skip when tile is not visible', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        isVisible: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('skip');
    });

    it('returns skip when tile zoom is below source minzoom', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 4, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        isVisible: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('skip');
    });

    it('returns request when tile zoom is above source maxzoom (should use parent tile)', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 15, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        isVisible: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('skip');
    });

    it('returns hide when cached tile is not visible', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: true,
        isPending: false,
        isVisible: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('hide');
    });

    it('returns show when cached tile is visible', () => {
      const options: TileLifecycleOptions = {
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: true,
        isPending: false,
        isVisible: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(computeTileLifecycle(options)).toBe('show');
    });
  });
});
