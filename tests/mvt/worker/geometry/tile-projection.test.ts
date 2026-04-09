import { describe, expect, it } from 'vitest';

describe('tile-projection', () => {
  describe('createTileProjectionContext', () => {
    it('should create projection context for tile', async () => {
      const { createTileProjectionContext } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const context = createTileProjectionContext(0, 0, 0, tilingScheme);

      expect(context.level).toBe(0);
      expect(context.x).toBe(0);
      expect(context.y).toBe(0);
      expect(context.projection).toBeDefined();
      expect(context.tileRectangle).toBeDefined();
    });
  });

  describe('projectTilePoint', () => {
    it('should project tile point to Cartesian3', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { WebMercatorTilingScheme, Cartesian3 } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const context = createTileProjectionContext(0, 0, 0, tilingScheme);

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
      const { WebMercatorTilingScheme, Cartesian3 } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const context = createTileProjectionContext(0, 0, 0, tilingScheme);

      const point = { x: 2048, y: 2048 };
      const extent = 4096;
      const projected = projectTilePoint(point, extent, context);

      const magnitude = Cartesian3.magnitude(projected);
      expect(magnitude).toBeCloseTo(6378137, -3);
    });

    it('should clamp out-of-bounds coordinates', async () => {
      const { createTileProjectionContext, projectTilePoint } = await import('../../../../src/mvt/worker/geometry/tile-projection');
      const { WebMercatorTilingScheme, Math: CesiumMath } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const context = createTileProjectionContext(0, 0, 0, tilingScheme);

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
  });
});
