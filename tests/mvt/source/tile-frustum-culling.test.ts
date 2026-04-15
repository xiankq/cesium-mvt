import { describe, expect, it } from 'vitest';
import { isTileVisibleInFrustum } from '@/mvt/source/tile-frustum-culling';

describe('tile-frustum-culling', () => {
  describe('isTileVisibleInFrustum', () => {
    it('should return true when tile is inside frustum', () => {
      const frustumPlanes = [
        { normal: { x: 1, y: 0, z: 0 }, distance: 0 },
        { normal: { x: -1, y: 0, z: 0 }, distance: 1000 },
        { normal: { x: 0, y: 1, z: 0 }, distance: 0 },
        { normal: { x: 0, y: -1, z: 0 }, distance: 1000 },
        { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
        { normal: { x: 0, y: 0, z: -1 }, distance: 1000 },
      ];

      const tileBoundingSphere = {
        center: { x: 500, y: 500, z: 500 },
        radius: 100,
      };

      const isVisible = isTileVisibleInFrustum({
        frustumPlanes,
        tileBoundingSphere,
      });

      expect(isVisible).toBe(true);
    });

    it('should return false when tile is outside frustum', () => {
      const frustumPlanes = [
        { normal: { x: 1, y: 0, z: 0 }, distance: 0 },
        { normal: { x: -1, y: 0, z: 0 }, distance: 100 },
        { normal: { x: 0, y: 1, z: 0 }, distance: 0 },
        { normal: { x: 0, y: -1, z: 0 }, distance: 100 },
        { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
        { normal: { x: 0, y: 0, z: -1 }, distance: 100 },
      ];

      const tileBoundingSphere = {
        center: { x: 500, y: 500, z: 500 },
        radius: 10,
      };

      const isVisible = isTileVisibleInFrustum({
        frustumPlanes,
        tileBoundingSphere,
      });

      expect(isVisible).toBe(false);
    });

    it('should return true when tile intersects frustum plane', () => {
      const frustumPlanes = [
        { normal: { x: 1, y: 0, z: 0 }, distance: 0 },
        { normal: { x: -1, y: 0, z: 0 }, distance: 100 },
        { normal: { x: 0, y: 1, z: 0 }, distance: 0 },
        { normal: { x: 0, y: -1, z: 0 }, distance: 100 },
        { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
        { normal: { x: 0, y: 0, z: -1 }, distance: 100 },
      ];

      const tileBoundingSphere = {
        center: { x: 95, y: 50, z: 50 },
        radius: 10,
      };

      const isVisible = isTileVisibleInFrustum({
        frustumPlanes,
        tileBoundingSphere,
      });

      expect(isVisible).toBe(true);
    });
  });
});
