import {
  Cartesian3,
  Math as CesiumMath,
  WebMercatorProjection,
  WebMercatorTilingScheme,
} from 'cesium';
import { describe, expect, it } from 'vitest';
import {
  createTileProjectionContext,
  projectTilePoint,
} from '@/mvt/geometry/tile-projection';

describe('tile-projection', () => {
  describe('createTileProjectionContext', () => {
    it('should create projection context from native tile projection data', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);

      expect(context.tileRectangle).toEqual(tileProjection);
    });
  });

  describe('projectTilePoint', () => {
    it('should project tile point to Cartesian3', () => {
      const context = createTileProjectionContext(createNativeTileProjection(0, 0, 0));
      const projected = projectTilePoint({ x: 2048, y: 2048 }, 4096, context);

      expect(projected).toBeInstanceOf(Cartesian3);
      expect(projected.x).toBeDefined();
      expect(projected.y).toBeDefined();
      expect(projected.z).toBeDefined();
    });

    it('should project center of tile at level 0', () => {
      const context = createTileProjectionContext(createNativeTileProjection(0, 0, 0));
      const projected = projectTilePoint({ x: 2048, y: 2048 }, 4096, context);

      expect(Cartesian3.magnitude(projected)).toBeCloseTo(6378137, -3);
    });

    it('should match Cesium WebMercator unprojection for low zoom points away from equator', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const point = { x: 2048, y: 1024 };

      const projected = projectTilePoint(point, 4096, context);
      const expected = projectWithCesium(point, 4096, tileProjection);

      expect(projected.x).toBeCloseTo(expected.x, 5);
      expect(projected.y).toBeCloseTo(expected.y, 5);
      expect(projected.z).toBeCloseTo(expected.z, 5);
      expect(extractLatitudeDegrees(projected)).toBeGreaterThan(60);
    });

    it('should project out-of-bounds coordinates correctly without clamping', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const point = { x: -100, y: 5000 };

      const projected = projectTilePoint(point, 4096, context);
      const expected = projectWithCesium(point, 4096, tileProjection);

      expect(projected.x).toBeCloseTo(expected.x, 5);
      expect(projected.y).toBeCloseTo(expected.y, 5);
      expect(projected.z).toBeCloseTo(expected.z, 5);
    });

    it('should project tile corners correctly', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const extent = 4096;

      const corners = [
        { x: 0, y: 0 },
        { x: extent, y: 0 },
        { x: 0, y: extent },
        { x: extent, y: extent },
      ];

      corners.forEach((point) => {
        const projected = projectTilePoint(point, extent, context);
        const expected = projectWithCesium(point, extent, tileProjection);

        expect(projected.x).toBeCloseTo(expected.x, 5);
        expect(projected.y).toBeCloseTo(expected.y, 5);
        expect(projected.z).toBeCloseTo(expected.z, 5);
      });
    });

    it('should handle tile near polar region', () => {
      const context = createTileProjectionContext(createNativeTileProjection(2, 0, 0));
      const projected = projectTilePoint({ x: 2048, y: 2048 }, 4096, context);

      expect(Math.abs(extractLatitudeDegrees(projected))).toBeGreaterThan(60);
    });

    it('should handle negative coordinates', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const point = { x: -100, y: -100 };

      const projected = projectTilePoint(point, 4096, context);
      const expected = projectWithCesium(point, 4096, tileProjection);

      expect(projected.x).toBeCloseTo(expected.x, 5);
      expect(projected.y).toBeCloseTo(expected.y, 5);
      expect(projected.z).toBeCloseTo(expected.z, 5);
    });

    it('should handle coordinates far outside tile bounds', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const point = { x: -10000, y: 15000 };

      const projected = projectTilePoint(point, 4096, context);
      const expected = projectWithCesium(point, 4096, tileProjection);

      expect(projected.x).toBeCloseTo(expected.x, 5);
      expect(projected.y).toBeCloseTo(expected.y, 5);
      expect(projected.z).toBeCloseTo(expected.z, 5);
    });

    it('should handle coordinates exactly at tile boundaries', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const extent = 4096;

      const boundaryPoints = [
        { x: 0, y: 0 },
        { x: extent, y: 0 },
        { x: 0, y: extent },
        { x: extent, y: extent },
      ];

      boundaryPoints.forEach((point) => {
        const projected = projectTilePoint(point, extent, context);
        const expected = projectWithCesium(point, extent, tileProjection);

        expect(projected.x).toBeCloseTo(expected.x, 5);
        expect(projected.y).toBeCloseTo(expected.y, 5);
        expect(projected.z).toBeCloseTo(expected.z, 5);
      });
    });

    it('should handle coordinates near tile boundaries', () => {
      const tileProjection = createNativeTileProjection(0, 0, 0);
      const context = createTileProjectionContext(tileProjection);
      const extent = 4096;

      const nearBoundaryPoints = [
        { x: -1, y: -1 },
        { x: extent + 1, y: extent + 1 },
        { x: 1, y: 1 },
        { x: extent - 1, y: extent - 1 },
      ];

      nearBoundaryPoints.forEach((point) => {
        const projected = projectTilePoint(point, extent, context);
        const expected = projectWithCesium(point, extent, tileProjection);

        expect(projected.x).toBeCloseTo(expected.x, 5);
        expect(projected.y).toBeCloseTo(expected.y, 5);
        expect(projected.z).toBeCloseTo(expected.z, 5);
      });
    });

    it('should handle invalid coordinates gracefully', () => {
      const context = createTileProjectionContext(createNativeTileProjection(0, 0, 0));
      const extent = 4096;

      const invalidPoints = [
        { x: Number.NaN, y: 100 },
        { x: 100, y: Number.NaN },
        { x: Infinity, y: 100 },
        { x: 100, y: -Infinity },
      ];

      invalidPoints.forEach((point) => {
        const projected = projectTilePoint(point, extent, context);
        expect(projected.x).toBe(0);
        expect(projected.y).toBe(0);
        expect(projected.z).toBe(0);
      });
    });

    it('should apply height offset to projected points when provided', () => {
      const context = createTileProjectionContext(createNativeTileProjection(0, 0, 0));
      const extent = 4096;
      const heightOffset = 10;

      const projectedWithOffset = projectTilePoint({ x: 2048, y: 2048 }, extent, context, heightOffset);
      const projectedWithoutOffset = projectTilePoint({ x: 2048, y: 2048 }, extent, context, 0);

      const magnitudeWithOffset = Cartesian3.magnitude(projectedWithOffset);
      const magnitudeWithoutOffset = Cartesian3.magnitude(projectedWithoutOffset);

      expect(magnitudeWithOffset).toBeGreaterThan(magnitudeWithoutOffset);
      expect(magnitudeWithOffset - magnitudeWithoutOffset).toBeCloseTo(heightOffset, 1);
    });

    it('should apply height offset to points at different latitudes', () => {
      const context = createTileProjectionContext(createNativeTileProjection(0, 0, 0));
      const extent = 4096;
      const heightOffset = 100;

      const points = [
        { x: 2048, y: 1024 },
        { x: 2048, y: 3072 },
        { x: 1024, y: 2048 },
        { x: 3072, y: 2048 },
      ];

      points.forEach((point) => {
        const projectedWithOffset = projectTilePoint(point, extent, context, heightOffset);
        const projectedWithoutOffset = projectTilePoint(point, extent, context, 0);

        const magnitudeWithOffset = Cartesian3.magnitude(projectedWithOffset);
        const magnitudeWithoutOffset = Cartesian3.magnitude(projectedWithoutOffset);

        expect(magnitudeWithOffset).toBeGreaterThan(magnitudeWithoutOffset);
        expect(magnitudeWithOffset - magnitudeWithoutOffset).toBeCloseTo(heightOffset, 0);
      });
    });
  });
});

function createNativeTileProjection(level: number, x: number, y: number) {
  const tilingScheme = new WebMercatorTilingScheme();
  const rect = tilingScheme.tileXYToNativeRectangle(x, y, level);
  return {
    east: rect.east,
    north: rect.north,
    south: rect.south,
    west: rect.west,
  };
}

function extractLatitudeDegrees(position: Cartesian3) {
  const magnitude = Cartesian3.magnitude(position);
  return CesiumMath.toDegrees(Math.asin(position.z / magnitude));
}

function projectWithCesium(
  point: { x: number; y: number },
  extent: number,
  tileProjection: ReturnType<typeof createNativeTileProjection>,
) {
  const projection = new WebMercatorProjection();
  const nativeWidth = tileProjection.east - tileProjection.west;
  const nativeHeight = tileProjection.north - tileProjection.south;
  const nativeX = tileProjection.west + (point.x / extent) * nativeWidth;
  const nativeY = tileProjection.north - (point.y / extent) * nativeHeight;
  const cartographic = projection.unproject(new Cartesian3(nativeX, nativeY, 0));

  return Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    0,
  );
}
