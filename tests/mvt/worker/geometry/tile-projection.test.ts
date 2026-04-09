import { describe, expect, it } from 'vitest';

describe('tile-projection', () => {
  describe('createTileProjectionContext', () => {
    it('should create projection context from tile projection data', async () => {
      const { createTileProjectionContext } = await import('../../../../src/mvt/worker/geometry/tile-projection');

      const tileProjection = {
        west: -Math.PI,
        south: -Math.PI / 2,
        east: Math.PI,
        north: Math.PI / 2,
      };
      const context = createTileProjectionContext(tileProjection);

      expect(context.tileRectangle).toBeDefined();
      expect(context.tileRectangle.west).toBe(-Math.PI);
      expect(context.tileRectangle.south).toBe(-Math.PI / 2);
      expect(context.tileRectangle.east).toBe(Math.PI);
      expect(context.tileRectangle.north).toBe(Math.PI / 2);
    });
  });

  describe('projectTilePoint', () => {
    it('should project tile point to Cartesian3', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { Cartesian3 } = await import('cesium');

      const tileProjection = {
        west: -Math.PI,
        south: -Math.PI / 2,
        east: Math.PI,
        north: Math.PI / 2,
      };
      const context = createTileProjectionContext(tileProjection);

      const point = { x: 2048, y: 2048 };
      const extent = 4096;
      const projected = projectTilePoint(point, extent, context);

      expect(projected).toBeInstanceOf(Cartesian3);
      expect(projected.x).toBeDefined();
      expect(projected.y).toBeDefined();
      expect(projected.z).toBeDefined();
    });

    it('should project center of tile at level 0', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { Cartesian3, WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const context = createTileProjectionContext(tileProjection);

      const point = { x: 2048, y: 2048 };
      const extent = 4096;
      const projected = projectTilePoint(point, extent, context);

      const magnitude = Cartesian3.magnitude(projected);
      expect(magnitude).toBeCloseTo(6378137, -3);
    });

    it('should clamp out-of-bounds coordinates', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { Math: CesiumMath, WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const context = createTileProjectionContext(tileProjection);

      const outOfBoundsPoint = { x: -100, y: 5000 };
      const extent = 4096;
      const projected = projectTilePoint(outOfBoundsPoint, extent, context);

      const lon = CesiumMath.toDegrees(Math.atan2(projected.y, projected.x));
      const lat = CesiumMath.toDegrees(Math.asin(projected.z / Math.sqrt(projected.x ** 2 + projected.y ** 2 + projected.z ** 2)));

      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-85.06);
      expect(lat).toBeLessThanOrEqual(85.06);
    });

    it('should project tile corners correctly', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
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
        expect(projected.x).toBeDefined();
        expect(projected.y).toBeDefined();
        expect(projected.z).toBeDefined();
      });
    });

    it('should handle tile near polar region', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { Math: CesiumMath, WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 2);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const context = createTileProjectionContext(tileProjection);

      const point = { x: 2048, y: 2048 };
      const extent = 4096;
      const projected = projectTilePoint(point, extent, context);

      const lat = CesiumMath.toDegrees(Math.asin(projected.z / Math.sqrt(projected.x ** 2 + projected.y ** 2 + projected.z ** 2)));
      expect(Math.abs(lat)).toBeGreaterThan(60);
    });

    it('should handle point at tile center', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { Cartesian3 } = await import('cesium');

      const tileProjection = {
        west: -Math.PI / 2,
        south: -Math.PI / 4,
        east: Math.PI / 2,
        north: Math.PI / 4,
      };
      const context = createTileProjectionContext(tileProjection);

      const point = { x: 2048, y: 2048 };
      const extent = 4096;
      const projected = projectTilePoint(point, extent, context);

      expect(Cartesian3.magnitude(projected)).toBeGreaterThan(0);
    });

    it('should handle negative coordinates', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { Math: CesiumMath, WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const context = createTileProjectionContext(tileProjection);

      const point = { x: -100, y: -100 };
      const extent = 4096;
      const projected = projectTilePoint(point, extent, context);

      const lon = CesiumMath.toDegrees(Math.atan2(projected.y, projected.x));
      const lat = CesiumMath.toDegrees(Math.asin(projected.z / Math.sqrt(projected.x ** 2 + projected.y ** 2 + projected.z ** 2)));

      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-85.06);
      expect(lat).toBeLessThanOrEqual(85.06);
    });
  });
});
