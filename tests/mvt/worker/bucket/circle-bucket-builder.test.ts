import { describe, expect, it } from 'vitest';

describe('circle-bucket-builder', () => {
  describe('circleBucketBuilder', () => {
    it('should create circle bucket builder with options', async () => {
      const { CircleBucketBuilder } = await import('../../../../src/mvt/worker/bucket/circle-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new CircleBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/circle/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      expect(builder.type).toBe('circle');
      expect(builder.stats.type).toBe('circle');
      expect(builder.stats.featureCount).toBe(0);
    });

    it('should add point feature and update stats', async () => {
      const { CircleBucketBuilder } = await import('../../../../src/mvt/worker/bucket/circle-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new CircleBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/circle/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockPointFeature({ x: 100, y: 100 });
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(1);
      expect(builder.stats.pointCount).toBeGreaterThan(0);
    });

    it('should ignore non-point features', async () => {
      const { CircleBucketBuilder } = await import('../../../../src/mvt/worker/bucket/circle-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new CircleBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/circle/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ]);
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(0);
    });

    it('should build bucket with typed arrays', async () => {
      const { CircleBucketBuilder } = await import('../../../../src/mvt/worker/bucket/circle-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new CircleBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/circle/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockPointFeature({ x: 100, y: 100 });
      builder.addFeature(feature, 0);
      const bucket = builder.build();

      expect(bucket.type).toBe('circle');
      expect(bucket.familyId).toBe('source/layer/circle/0');
      expect(bucket.layerIds).toEqual(['layer1']);
      expect(bucket.sourceLayer).toBe('layer');
      expect(bucket.data.positions).toBeInstanceOf(Float64Array);
      expect(bucket.data.featureIds).toBeInstanceOf(Float32Array);
      expect(bucket.stats.byteLength).toBeGreaterThan(0);
      expect(bucket.featureIndex.entries).toHaveLength(1);
      expect(bucket.featureIndex.entries[0].id).toBe(1);
      expect(bucket.featureIndex.entries[0].properties).toEqual({ name: 'test' });
    });
  });
});

function createMockPointFeature(point: { x: number; y: number }) {
  return {
    type: 1 as const,
    id: 1,
    properties: { name: 'test' },
    loadGeometry: () => [[{ x: point.x, y: point.y }]],
  } as any;
}

function createMockLineFeature(lines: Array<Array<{ x: number; y: number }>>) {
  return {
    type: 2 as const,
    id: 2,
    properties: {},
    loadGeometry: () => lines.map(line => line.map(p => ({ x: p.x, y: p.y }))),
  } as any;
}
