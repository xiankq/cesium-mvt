import { describe, expect, it } from 'vitest';

describe('bucket-fill-backend', () => {
  describe('createBucketFillTileHandle', () => {
    it('should create fill tile handle from bucket tile', async () => {
      const { createBucketFillTileHandle } = await import('../../../../src/mvt/render/backend/bucket-fill-backend');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const bucketTile = createMockBucketTile('fill');
      const style = createMockStyle('fill');

      const handle = createBucketFillTileHandle({
        bucketTile,
        level: 0,
        style,
        tilingScheme,
        x: 0,
        y: 0,
      });

      expect(handle).toBeDefined();
      expect(handle?.key).toBe('source/0/0/0');
      expect(handle?.collections).toBeDefined();
      expect(handle?.collections.length).toBeGreaterThan(0);
    });

    it('should return undefined for empty bucket tile', async () => {
      const { createBucketFillTileHandle } = await import('../../../../src/mvt/render/backend/bucket-fill-backend');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const bucketTile = createMockEmptyBucketTile();
      const style = createMockStyle('fill');

      const handle = createBucketFillTileHandle({
        bucketTile,
        level: 0,
        style,
        tilingScheme,
        x: 0,
        y: 0,
      });

      expect(handle).toBeUndefined();
    });

    it('should handle multiple features in a bucket', async () => {
      const { createBucketFillTileHandle } = await import('../../../../src/mvt/render/backend/bucket-fill-backend');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const bucketTile = createMockBucketTileWithMultipleFeatures();
      const style = createMockStyle('fill');

      const handle = createBucketFillTileHandle({
        bucketTile,
        level: 0,
        style,
        tilingScheme,
        x: 0,
        y: 0,
      });

      expect(handle).toBeDefined();
      expect(handle?.collections).toBeDefined();
      expect(handle?.collections.length).toBeGreaterThan(0);

      const collectionHandle = handle!.collections[0];
      expect(collectionHandle.polygonCount).toBe(2);
      expect(collectionHandle.collection).toBeDefined();
    });
  });
});

function createMockBucketTile(type: 'fill' | 'line' | 'circle') {
  return {
    buckets: [
      {
        type,
        familyId: `source/layer/${type}/0`,
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        stats: {
          type,
          featureCount: 1,
          byteLength: 100,
          polygonCount: type === 'fill' ? 1 : undefined,
          triangleCount: type === 'fill' ? 1 : undefined,
          vertexCount: type === 'fill' ? 3 : undefined,
          holeCount: type === 'fill' ? 0 : undefined,
        },
        data: {
          positions: new Float64Array([0, 0, 0, 100, 0, 0, 100, 100, 0]),
          triangles: new Uint32Array([0, 1, 2]),
          featureIds: new Float32Array([0, 0, 0]),
          holes: new Uint32Array([]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test' },
              type: 'polygon',
            },
          ],
          byteLength: 50,
        },
      },
    ],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

function createMockEmptyBucketTile() {
  return {
    buckets: [],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 0,
  };
}

function createMockBucketTileWithMultipleFeatures() {
  return {
    buckets: [
      {
        type: 'fill' as const,
        familyId: 'source/layer/fill/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        stats: {
          type: 'fill' as const,
          featureCount: 2,
          byteLength: 200,
          polygonCount: 2,
          triangleCount: 2,
          vertexCount: 6,
          holeCount: 0,
        },
        data: {
          positions: new Float64Array([
            0,
            0,
            0,
            100,
            0,
            0,
            100,
            100,
            0,
            200,
            0,
            0,
            300,
            0,
            0,
            300,
            100,
            0,
          ]),
          triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
          featureIds: new Float32Array([0, 0, 0, 1, 1, 1]),
          holes: new Uint32Array([]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test1' },
              type: 'polygon' as const,
            },
            {
              id: 2,
              properties: { name: 'test2' },
              type: 'polygon' as const,
            },
          ],
          byteLength: 100,
        },
      },
    ],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 200,
  };
}

function createMockStyle(type: 'fill' | 'line' | 'circle') {
  return {
    version: 8 as const,
    sources: {},
    layers: [
      {
        'id': 'layer1',
        type,
        'source': 'source',
        'source-layer': 'layer',
        'paint': type === 'fill'
          ? { 'fill-color': '#ff0000' }
          : type === 'line'
            ? { 'line-color': '#00ff00' }
            : { 'circle-color': '#0000ff' },
      },
    ],
  } as any;
}
