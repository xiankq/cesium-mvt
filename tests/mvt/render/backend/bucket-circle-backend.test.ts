import { describe, expect, it } from 'vitest';

describe('bucket-circle-backend', () => {
  describe('createBucketCircleTileHandle', () => {
    it('should return undefined for empty bucket tile', async () => {
      const { createBucketCircleTileHandle }
        = await import('@/mvt/render/backend/bucket-circle-backend');

      const bucketTile = createMockEmptyBucketTile();
      const style = createMockStyle('circle');

      const handle = createBucketCircleTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeUndefined();
    });

    it('should create circle tile handle from bucket tile', async () => {
      const { createBucketCircleTileHandle }
        = await import('@/mvt/render/backend/bucket-circle-backend');

      const bucketTile = createMockBucketTile('circle');
      const style = createMockStyle('circle');

      const handle = createBucketCircleTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeDefined();
      expect(handle?.key).toBe('source/0/0/0');
      expect(handle?.collections).toBeDefined();
      expect(handle?.collections.length).toBeGreaterThan(0);
    });

    it('should create one collection per style layer in the bucket', async () => {
      const { createBucketCircleTileHandle }
        = await import('@/mvt/render/backend/bucket-circle-backend');

      const bucketTile = createMockBucketTileWithLayerIds(['layer1', 'layer2']);
      const style = createMockStyle('circle', ['layer1', 'layer2']);

      const handle = createBucketCircleTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeDefined();
      expect(handle?.collections).toHaveLength(2);
      expect(handle?.collections.map(collection => collection.layerId)).toEqual([
        'layer1',
        'layer2',
      ]);
      expect(handle?.collections.map(collection => collection.pointCount)).toEqual([
        1,
        1,
      ]);
    });

    it('should handle multiple features in a bucket', async () => {
      const { createBucketCircleTileHandle }
        = await import('@/mvt/render/backend/bucket-circle-backend');

      const bucketTile = createMockBucketTileWithMultipleFeatures();
      const style = createMockStyle('circle');

      const handle = createBucketCircleTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeDefined();
      expect(handle?.collections).toBeDefined();
      expect(handle?.collections.length).toBeGreaterThan(0);

      const collectionHandle = handle!.collections[0];
      expect(collectionHandle.pointCount).toBe(2);
      expect(collectionHandle.collection).toBeDefined();
    });
  });
});

function createMockEmptyBucketTile() {
  return {
    buckets: [],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 0,
  };
}

function createMockBucketTile(type: 'fill' | 'line' | 'circle') {
  return {
    buckets: [
      {
        type: type as 'circle',
        familyId: `source/layer/${type}/0`,
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        stats: {
          type: type as 'circle',
          featureCount: 1,
          byteLength: 100,
          pointCount: type === 'circle' ? 1 : undefined,
        },
        data: {
          positions: new Float64Array([0, 0, 0]),
          featureIds: new Float32Array([0]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test' },
              type: 'point',
            },
          ],
          byteLength: 50,
        },
      },
    ],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  } as any;
}

function createMockBucketTileWithLayerIds(layerIds: string[]) {
  return {
    buckets: [
      {
        type: 'circle' as const,
        familyId: 'source/layer/circle/0',
        layerIds,
        sourceLayer: 'layer',
        stats: {
          type: 'circle' as const,
          featureCount: 1,
          byteLength: 100,
          pointCount: 1,
        },
        data: {
          positions: new Float64Array([0, 0, 0]),
          featureIds: new Float32Array([0]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test' },
              type: 'point' as const,
            },
          ],
          byteLength: 50,
        },
      },
    ],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  } as any;
}

function createMockBucketTileWithMultipleFeatures() {
  return {
    buckets: [
      {
        type: 'circle' as const,
        familyId: 'source/layer/circle/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        stats: {
          type: 'circle' as const,
          featureCount: 2,
          byteLength: 200,
          pointCount: 2,
        },
        data: {
          positions: new Float64Array([0, 0, 0, 100, 100, 0]),
          featureIds: new Float32Array([0, 1]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test1' },
              type: 'point' as const,
            },
            {
              id: 2,
              properties: { name: 'test2' },
              type: 'point' as const,
            },
          ],
          byteLength: 100,
        },
      },
    ],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 200,
  } as any;
}

function createMockStyle(
  type: 'fill' | 'line' | 'circle',
  layerIds: string[] = ['layer1'],
) {
  return {
    version: 8 as const,
    sources: {},
    layers: layerIds.map(id => ({
      id,
      type,
      'source': 'source',
      'source-layer': 'layer',
      'paint':
                type === 'fill'
                  ? { 'fill-color': '#ff0000' }
                  : type === 'line'
                    ? { 'line-color': '#00ff00' }
                    : { 'circle-color': '#0000ff' },
    })),
  } as any;
}
