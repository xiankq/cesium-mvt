import { describe, expect, it } from 'vitest';

describe('fill-bucket-builder-integration', () => {
  describe('projection and subdivision', () => {
    it('should project and subdivide polygon geometry', async () => {
      const { FillBucketBuilder } = await import('../../../../src/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tilingScheme,
        level: 0,
        x: 0,
        y: 0,
      });

      const feature = createMockPolygonFeature([
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ],
      ]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      expect(bucket.data.positions.length).toBeGreaterThan(0);
      expect(bucket.data.triangles.length).toBeGreaterThan(0);
      expect(bucket.stats.vertexCount).toBeGreaterThan(4);
    });

    it('should handle multiple rings', async () => {
      const { FillBucketBuilder } = await import('../../../../src/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tilingScheme,
        level: 0,
        x: 0,
        y: 0,
      });

      const feature = createMockPolygonFeature([
        [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 200 },
          { x: 0, y: 200 },
          { x: 0, y: 0 },
        ],
        [
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 150 },
          { x: 50, y: 150 },
          { x: 50, y: 50 },
        ],
      ]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      expect(bucket.stats.holeCount).toBe(1);
      expect(bucket.data.holes.length).toBeGreaterThan(0);
    });
  });
});

function createMockPolygonFeature(rings: Array<Array<{ x: number; y: number }>>) {
  return {
    type: 3 as const,
    id: 1,
    properties: { name: 'test' },
    loadGeometry: () => rings.map(ring => ring.map(p => ({ x: p.x, y: p.y }))),
  };
}
