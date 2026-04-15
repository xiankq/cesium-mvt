import { describe, expect, it } from 'vitest';
import { isTileVisibleThroughFog } from '@/mvt/source/tile-fog-culling';

describe('tile-fog-culling', () => {
  describe('isTileVisibleThroughFog', () => {
    it('should return true when tile is within fog distance', () => {
      const cameraPosition = { x: 0, y: 0, z: 0 };
      const tileCenter = { x: 100, y: 100, z: 100 };
      const tileRadius = 10;
      const fogMaximumDistance = 1000;

      const isVisible = isTileVisibleThroughFog({
        cameraPosition,
        tileCenter,
        tileRadius,
        fogMaximumDistance,
      });

      expect(isVisible).toBe(true);
    });

    it('should return false when tile is beyond fog distance', () => {
      const cameraPosition = { x: 0, y: 0, z: 0 };
      const tileCenter = { x: 2000, y: 2000, z: 2000 };
      const tileRadius = 10;
      const fogMaximumDistance = 1000;

      const isVisible = isTileVisibleThroughFog({
        cameraPosition,
        tileCenter,
        tileRadius,
        fogMaximumDistance,
      });

      expect(isVisible).toBe(false);
    });

    it('should return true when tile intersects fog boundary', () => {
      const cameraPosition = { x: 0, y: 0, z: 0 };
      const tileCenter = { x: 1000, y: 0, z: 0 };
      const tileRadius = 100;
      const fogMaximumDistance = 1000;

      const isVisible = isTileVisibleThroughFog({
        cameraPosition,
        tileCenter,
        tileRadius,
        fogMaximumDistance,
      });

      expect(isVisible).toBe(true);
    });

    it('should return true when fog is disabled', () => {
      const cameraPosition = { x: 0, y: 0, z: 0 };
      const tileCenter = { x: 10000, y: 10000, z: 10000 };
      const tileRadius = 10;
      const fogMaximumDistance = Number.POSITIVE_INFINITY;

      const isVisible = isTileVisibleThroughFog({
        cameraPosition,
        tileCenter,
        tileRadius,
        fogMaximumDistance,
      });

      expect(isVisible).toBe(true);
    });
  });
});
