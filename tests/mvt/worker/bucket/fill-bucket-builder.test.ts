import { describe, expect, it } from 'vitest';

describe('fill-bucket-builder', () => {
  describe('fillBucketBuilder', () => {
    it('should create fill bucket builder with options', async () => {
      const { FillBucketBuilder } = await import('@/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      expect(builder.type).toBe('fill');
      expect(builder.stats.type).toBe('fill');
      expect(builder.stats.featureCount).toBe(0);
    });

    it('should add polygon feature and update stats', async () => {
      const { FillBucketBuilder } = await import('@/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
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

      expect(builder.stats.featureCount).toBe(1);
      expect(builder.stats.polygonCount).toBeGreaterThan(0);
      expect(builder.stats.vertexCount).toBeGreaterThan(0);
      expect(builder.stats.triangleCount).toBeGreaterThan(0);
    });

    it('should ignore non-polygon features', async () => {
      const { FillBucketBuilder } = await import('@/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockPointFeature({ x: 0, y: 0 });
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(0);
    });

    it('should build bucket with typed arrays', async () => {
      const { FillBucketBuilder } = await import('@/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
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

      expect(bucket.type).toBe('fill');
      expect(bucket.familyId).toBe('source/layer/fill/0');
      expect(bucket.layerIds).toEqual(['layer1']);
      expect(bucket.sourceLayer).toBe('layer');
      expect((bucket.data as any).positions).toBeInstanceOf(Float64Array);
      expect((bucket.data as any).triangles).toBeInstanceOf(Uint32Array);
      expect((bucket.data as any).holes).toBeInstanceOf(Uint32Array);
      expect((bucket.data as any).featureIds).toBeInstanceOf(Float32Array);
      expect(bucket.stats.byteLength).toBeGreaterThan(0);
      expect(bucket.featureIndex.entries).toHaveLength(1);
      expect(bucket.featureIndex.entries[0].id).toBe(1);
      expect(bucket.featureIndex.entries[0].properties).toEqual({ name: 'test' });
    });

    it('should triangulate polygon correctly', async () => {
      const { FillBucketBuilder } = await import('@/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(1, 0, 1);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/1/1/0',
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

      const fillData = bucket.data as any;
      const triangleCount = fillData.triangles.length / 3;
      const vertexCount = fillData.positions.length / 3;

      expect(triangleCount).toBeGreaterThan(0);
      expect(triangleCount).toBeLessThan(vertexCount);

      for (let i = 0; i < fillData.triangles.length; i++) {
        const index = fillData.triangles[i];
        expect(index).toBeLessThan(vertexCount);
        expect(index).toBeGreaterThanOrEqual(0);
      }

      expect(triangleCount).toBe(vertexCount - 2);
    });

    it('should handle polygon with hole correctly', async () => {
      const { FillBucketBuilder } = await import('@/mvt/worker/bucket/fill-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(1, 0, 1);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new FillBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/1/1/0',
      });

      const outerRing = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
        { x: 0, y: 0 },
      ];

      const innerRing = [
        { x: 50, y: 50 },
        { x: 50, y: 150 },
        { x: 150, y: 150 },
        { x: 150, y: 50 },
        { x: 50, y: 50 },
      ];

      const feature = createMockPolygonFeature([outerRing, innerRing]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      const fillData = bucket.data as any;
      const triangleCount = fillData.triangles.length / 3;
      const vertexCount = fillData.positions.length / 3;
      const holeCount = fillData.holes.length;

      expect(triangleCount).toBeGreaterThan(0);
      expect(holeCount).toBe(1);
      expect(triangleCount).toBeLessThanOrEqual(vertexCount);
    });
  });
});

function createMockPolygonFeature(rings: Array<Array<{ x: number; y: number }>>) {
  return {
    type: 3 as const,
    id: 1,
    properties: { name: 'test' },
    loadGeometry: () => rings.map(ring => ring.map(p => ({ x: p.x, y: p.y }))),
  } as any;
}

function createMockPointFeature(point: { x: number; y: number }) {
  return {
    type: 1 as const,
    id: 2,
    properties: {},
    loadGeometry: () => [[{ x: point.x, y: point.y }]],
  } as any;
}
