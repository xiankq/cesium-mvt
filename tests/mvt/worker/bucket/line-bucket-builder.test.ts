import { describe, expect, it } from 'vitest';

describe('line-bucket-builder', () => {
  describe('lineBucketBuilder', () => {
    it('should create line bucket builder with options', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      expect(builder.type).toBe('line');
      expect(builder.stats.type).toBe('line');
      expect(builder.stats.featureCount).toBe(0);
    });

    it('should add line feature and update stats', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      ]);

      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(1);
      expect(builder.stats.polylineCount).toBeGreaterThan(0);
      expect(builder.stats.totalVertexCount).toBeGreaterThan(0);
    });

    it('should ignore non-line features', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
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
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      ]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      expect(bucket.type).toBe('line');
      expect(bucket.familyId).toBe('source/layer/line/0');
      expect(bucket.layerIds).toEqual(['layer1']);
      expect(bucket.sourceLayer).toBe('layer');
      expect((bucket.data as any).positions).toBeInstanceOf(Float64Array);
      expect((bucket.data as any).featureIds).toBeInstanceOf(Float32Array);
      expect((bucket.data as any).vertexCounts).toBeInstanceOf(Uint32Array);
      expect(bucket.stats.byteLength).toBeGreaterThan(0);
      expect(bucket.featureIndex.entries).toHaveLength(1);
      expect(bucket.featureIndex.entries[0].id).toBe(1);
      expect(bucket.featureIndex.entries[0].properties).toEqual({ name: 'test' });
    });

    it('should subdivide all segments of a polyline', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme, Cartesian3, Math: CesiumMath } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(1, 0, 1);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/1/1/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 200, y: 0 },
          { x: 300, y: 0 },
        ],
      ]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      const lineData = bucket.data as any;
      const vertexCount = lineData.positions.length / 3;

      const positions = lineData.positions;
      const points: any[] = [];
      for (let i = 0; i < positions.length; i += 3) {
        points.push(new Cartesian3(positions[i], positions[i + 1], positions[i + 2]));
      }

      const lons = points.map(p => CesiumMath.toDegrees(Math.atan2(p.y, p.x)));
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const lonRange = maxLon - minLon;

      expect(vertexCount).toBeGreaterThan(10);
      expect(lonRange).toBeGreaterThan(0.01);
    });

    it('should handle empty geometry', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([]);
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(0);
    });

    it('should handle single point line', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([[{ x: 100, y: 100 }]]);
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(0);
    });

    it('should handle line with all same points', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 100 },
        ],
      ]);
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(0);
    });

    it('should handle multiple polylines in one feature', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
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
        [
          { x: 200, y: 200 },
          { x: 300, y: 200 },
        ],
      ]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      expect(builder.stats.featureCount).toBe(1);
      expect(builder.stats.polylineCount).toBe(2);
      expect((bucket.data as any).positions.length).toBeGreaterThan(0);
    });

    it('should handle very dense line', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const points = [];
      for (let i = 0; i <= 1000; i++) {
        points.push({ x: i * 4, y: i * 4 });
      }

      const feature = createMockLineFeature([points]);
      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(1);
      expect(builder.stats.totalVertexCount).toBeGreaterThan(100);
    });

    it('should handle coordinates at extent boundaries', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 0, y: 0 },
          { x: 4096, y: 0 },
          { x: 4096, y: 4096 },
          { x: 0, y: 4096 },
        ],
      ]);

      builder.addFeature(feature, 0);
      const bucket = builder.build();

      expect(builder.stats.featureCount).toBe(1);
      expect((bucket.data as any).positions.length).toBeGreaterThan(0);
    });

    it('should handle negative coordinates', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: -100, y: 100 },
          { x: 100, y: 100 },
        ],
      ]);

      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(1);
    });

    it('should handle coordinates beyond extent', async () => {
      const { LineBucketBuilder } = await import('../../../../src/mvt/worker/bucket/line-bucket-builder');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const builder = new LineBucketBuilder({
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileProjection,
        tileKey: 'source/0/0/0',
      });

      const feature = createMockLineFeature([
        [
          { x: 4000, y: 4000 },
          { x: 5000, y: 4000 },
        ],
      ]);

      builder.addFeature(feature, 0);

      expect(builder.stats.featureCount).toBe(1);
    });
  });
});

function createMockLineFeature(lines: Array<Array<{ x: number; y: number }>>) {
  return {
    type: 2 as const,
    id: 1,
    properties: { name: 'test' },
    loadGeometry: () => lines.map(line => line.map(p => ({ x: p.x, y: p.y }))),
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
