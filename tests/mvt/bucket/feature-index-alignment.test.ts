import { describe, expect, it } from 'vitest';

describe('feature-index alignment', () => {
  it('line bucket should keep source feature indices when earlier features are skipped', async () => {
    const { WebMercatorTilingScheme } = await import('cesium');
    const { LineBucketBuilder } = await import('@/mvt/bucket/line-bucket-builder');

    const builder = new LineBucketBuilder(createBucketOptions());
    builder.addFeature(createPolygonFeature(), 0);
    builder.addFeature(createLineFeature(), 1);

    const bucket = builder.build();

    expect(bucket.featureIndex.entries[0]).toBeUndefined();
    expect(bucket.featureIndex.entries[1]).toMatchObject({
      id: 2,
      properties: {
        kind: 'road',
      },
      type: 'line',
    });
    expect(bucket.featureIndex.byteLength).toBe(200);

    function createBucketOptions() {
      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      return {
        extent: 4096,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileKey: 'source/0/0/0',
        tileProjection: {
          east: rect.east,
          north: rect.north,
          south: rect.south,
          west: rect.west,
        },
      };
    }

    function createPolygonFeature() {
      return {
        id: 1,
        loadGeometry: () => [[
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ]],
        properties: {
          kind: 'land',
        },
        type: 3,
      } as any;
    }

    function createLineFeature() {
      return {
        id: 2,
        loadGeometry: () => [[
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]],
        properties: {
          kind: 'road',
        },
        type: 2,
      } as any;
    }
  });

  it('fill bucket should keep source feature indices when earlier features are skipped', async () => {
    const { WebMercatorTilingScheme } = await import('cesium');
    const { FillBucketBuilder } = await import('@/mvt/bucket/fill-bucket-builder');

    const builder = new FillBucketBuilder(createBucketOptions());
    builder.addFeature(createLineFeature(), 0);
    builder.addFeature(createPolygonFeature(), 1);

    const bucket = builder.build();

    expect(bucket.featureIndex.entries[0]).toBeUndefined();
    expect(bucket.featureIndex.entries[1]).toMatchObject({
      id: 2,
      properties: {
        kind: 'park',
      },
      type: 'polygon',
    });
    expect(bucket.featureIndex.byteLength).toBe(200);

    function createBucketOptions() {
      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      return {
        extent: 4096,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileKey: 'source/0/0/0',
        tileProjection: {
          east: rect.east,
          north: rect.north,
          south: rect.south,
          west: rect.west,
        },
      };
    }

    function createPolygonFeature() {
      return {
        id: 2,
        loadGeometry: () => [[
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ]],
        properties: {
          kind: 'park',
        },
        type: 3,
      } as any;
    }

    function createLineFeature() {
      return {
        id: 1,
        loadGeometry: () => [[
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]],
        properties: {
          kind: 'road',
        },
        type: 2,
      } as any;
    }
  });

  it('circle bucket should keep source feature indices when earlier features are skipped', async () => {
    const { WebMercatorTilingScheme } = await import('cesium');
    const { CircleBucketBuilder } = await import('@/mvt/bucket/circle-bucket-builder');

    const builder = new CircleBucketBuilder(createBucketOptions());
    builder.addFeature(createLineFeature(), 0);
    builder.addFeature(createPointFeature(), 1);

    const bucket = builder.build();

    expect(bucket.featureIndex.entries[0]).toBeUndefined();
    expect(bucket.featureIndex.entries[1]).toMatchObject({
      id: 2,
      properties: {
        kind: 'poi',
      },
      type: 'point',
    });
    expect(bucket.featureIndex.byteLength).toBe(200);

    function createBucketOptions() {
      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      return {
        extent: 4096,
        familyId: 'source/layer/circle/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        tileKey: 'source/0/0/0',
        tileProjection: {
          east: rect.east,
          north: rect.north,
          south: rect.south,
          west: rect.west,
        },
      };
    }

    function createPointFeature() {
      return {
        id: 2,
        loadGeometry: () => [[{ x: 50, y: 50 }]],
        properties: {
          kind: 'poi',
        },
        type: 1,
      } as any;
    }

    function createLineFeature() {
      return {
        id: 1,
        loadGeometry: () => [[
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]],
        properties: {
          kind: 'road',
        },
        type: 2,
      } as any;
    }
  });
});
