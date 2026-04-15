import { describe, expect, it } from 'vitest';
import { isTileVisibleAboveHorizon } from '@/mvt/source/tile-horizon-culling';

describe('tile-horizon-culling', () => {
  describe('isTileVisibleAboveHorizon', () => {
    it('should return true when tile is above horizon', () => {
      const cameraPosition = { x: 0, y: 0, z: 6378137 + 1000 };
      const tileCenter = { x: 100, y: 100, z: 6378137 };
      const tileRadius = 10;
      const ellipsoidRadii = { x: 6378137, y: 6378137, z: 6356752.3142451793 };

      const isVisible = isTileVisibleAboveHorizon({
        cameraPosition,
        tileCenter,
        tileRadius,
        ellipsoidRadii,
      });

      expect(isVisible).toBe(true);
    });

    it('should return false when tile is below horizon', () => {
      const cameraPosition = { x: 0, y: 0, z: 6378137 + 1000 };
      const tileCenter = { x: 0, y: 0, z: -1000 };
      const tileRadius = 10;
      const ellipsoidRadii = { x: 6378137, y: 6378137, z: 6356752.3142451793 };

      const isVisible = isTileVisibleAboveHorizon({
        cameraPosition,
        tileCenter,
        tileRadius,
        ellipsoidRadii,
      });

      expect(isVisible).toBe(false);
    });

    it('should return true when tile intersects horizon', () => {
      const cameraPosition = { x: 0, y: 0, z: 6378137 + 1000 };
      const tileCenter = { x: 0, y: 0, z: 0 };
      const tileRadius = 6378137;
      const ellipsoidRadii = { x: 6378137, y: 6378137, z: 6356752.3142451793 };

      const isVisible = isTileVisibleAboveHorizon({
        cameraPosition,
        tileCenter,
        tileRadius,
        ellipsoidRadii,
      });

      expect(isVisible).toBe(true);
    });
  });
});
