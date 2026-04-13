import type { TileVisibilityContext } from '@/mvt/source/tile-visibility';
import { describe, expect, it } from 'vitest';
import {
  computeTileVisibility,
  createTileVisibilityContext,
  isTileVisibleAtZoom,
  shouldRenderTile,
  shouldRequestTile,

} from '@/mvt/source/tile-visibility';

describe('tile-visibility', () => {
  describe('isTileVisibleAtZoom', () => {
    it('returns true when zoom is within minzoom and maxzoom range', () => {
      expect(isTileVisibleAtZoom(10, { maxZoom: 14, minZoom: 5 })).toBe(true);
    });

    it('returns true when zoom equals minzoom', () => {
      expect(isTileVisibleAtZoom(5, { maxZoom: 14, minZoom: 5 })).toBe(true);
    });

    it('returns false when zoom equals maxzoom (maxzoom is exclusive)', () => {
      expect(isTileVisibleAtZoom(14, { maxZoom: 14, minZoom: 5 })).toBe(false);
    });

    it('returns false when zoom is below minzoom', () => {
      expect(isTileVisibleAtZoom(4, { maxZoom: 14, minZoom: 5 })).toBe(false);
    });

    it('returns false when zoom is above maxzoom', () => {
      expect(isTileVisibleAtZoom(15, { maxZoom: 14, minZoom: 5 })).toBe(false);
    });

    it('returns true when minzoom is undefined and zoom is within maxzoom', () => {
      expect(isTileVisibleAtZoom(10, { maxZoom: 14 })).toBe(true);
    });

    it('returns true when maxzoom is undefined and zoom is above minzoom', () => {
      expect(isTileVisibleAtZoom(10, { minZoom: 5 })).toBe(true);
    });

    it('returns true when both minzoom and maxzoom are undefined', () => {
      expect(isTileVisibleAtZoom(10, {})).toBe(true);
    });
  });

  describe('shouldRequestTile', () => {
    it('returns true when tile is within zoom range and not cached', () => {
      const result = shouldRequestTile({
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(true);
    });

    it('returns false when tile is already cached', () => {
      const result = shouldRequestTile({
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: true,
        isPending: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(false);
    });

    it('returns false when tile is already pending', () => {
      const result = shouldRequestTile({
        coordinate: { level: 10, x: 100, y: 100 },
        isCached: false,
        isPending: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(false);
    });

    it('returns false when tile zoom is below source minzoom', () => {
      const result = shouldRequestTile({
        coordinate: { level: 4, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(false);
    });

    it('returns false when tile zoom is above source maxzoom', () => {
      const result = shouldRequestTile({
        coordinate: { level: 15, x: 100, y: 100 },
        isCached: false,
        isPending: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(false);
    });
  });

  describe('shouldRenderTile', () => {
    it('returns true when tile has data and is within zoom range', () => {
      const result = shouldRenderTile({
        coordinate: { level: 10, x: 100, y: 100 },
        hasData: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(true);
    });

    it('returns false when tile has no data', () => {
      const result = shouldRenderTile({
        coordinate: { level: 10, x: 100, y: 100 },
        hasData: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(false);
    });

    it('returns false when tile zoom is below source minzoom', () => {
      const result = shouldRenderTile({
        coordinate: { level: 4, x: 100, y: 100 },
        hasData: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(false);
    });

    it('returns true when tile zoom is above source maxzoom (overzoomed tiles should render)', () => {
      const result = shouldRenderTile({
        coordinate: { level: 15, x: 100, y: 100 },
        hasData: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      });
      expect(result).toBe(true);
    });
  });

  describe('computeTileVisibility', () => {
    it('returns visible when tile is in frustum and within distance', () => {
      const context: TileVisibilityContext = {
        cameraPosition: { x: 0, y: 0, z: 10000000 } as any,
        cullingVolume: {
          computeVisibility: () => 1,
        } as any,
        distanceThreshold: 1000000,
        horizonDistance: 50000000,
      };

      const result = computeTileVisibility({
        boundingSphereCenter: { x: 0, y: 0, z: 0 } as any,
        boundingSphereRadius: 100000,
        context,
        tileLevel: 10,
      });

      expect(result).toBe('visible');
    });

    it('returns hidden when tile is outside frustum', () => {
      const context: TileVisibilityContext = {
        cameraPosition: { x: 0, y: 0, z: 10000000 } as any,
        cullingVolume: {
          computeVisibility: () => -1,
        } as any,
        distanceThreshold: 1000000,
        horizonDistance: 5000000,
      };

      const result = computeTileVisibility({
        boundingSphereCenter: { x: 100000000, y: 0, z: 0 } as any,
        boundingSphereRadius: 100000,
        context,
        tileLevel: 10,
      });

      expect(result).toBe('hidden');
    });

    it('returns hidden when tile is beyond horizon distance', () => {
      const context: TileVisibilityContext = {
        cameraPosition: { x: 0, y: 0, z: 10000000 } as any,
        cullingVolume: {
          computeVisibility: () => 1,
        } as any,
        distanceThreshold: 1000000,
        horizonDistance: 100000,
      };

      const result = computeTileVisibility({
        boundingSphereCenter: { x: 0, y: 0, z: 0 } as any,
        boundingSphereRadius: 100000,
        context,
        tileLevel: 10,
      });

      expect(result).toBe('hidden');
    });
  });

  describe('createTileVisibilityContext', () => {
    it('creates context from camera and frame state', () => {
      const mockCamera = {
        position: { x: 0, y: 0, z: 10000000 },
        frustum: {
          computeCullingVolume: () => ({
            computeVisibility: () => 1,
          }),
        },
        direction: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
      };

      const context = createTileVisibilityContext({
        camera: mockCamera as any,
        viewportHeight: 1000,
        viewportWidth: 2000,
      });

      expect(context).toBeDefined();
      expect(context.cameraPosition).toEqual({ x: 0, y: 0, z: 10000000 });
      expect(context.cullingVolume).toBeDefined();
      expect(context.horizonDistance).toBeGreaterThan(0);
    });
  });
});
