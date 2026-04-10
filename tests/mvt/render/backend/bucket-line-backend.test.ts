import { describe, expect, it } from 'vitest';
import { createMockStyle } from '../../../helpers/style-helpers';

describe('bucket-line-backend', () => {
  describe('createBucketLineTileHandle', () => {
    it('should return undefined for empty bucket tile', async () => {
      const { createBucketLineTileHandle }
        = await import('@/mvt/render/backend/bucket-line-backend');

      const bucketTile = createMockEmptyBucketTile();
      const style = createMockStyle('line');

      const handle = createBucketLineTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeUndefined();
    });

    it('should create line tile handle from bucket tile', async () => {
      const { createBucketLineTileHandle }
        = await import('@/mvt/render/backend/bucket-line-backend');

      const bucketTile = createMockBucketTile('line');
      const style = createMockStyle('line');

      const handle = createBucketLineTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeDefined();
      expect(handle?.key).toBe('source/0/0/0');
      expect(handle?.collections).toBeDefined();
      expect(handle?.collections.length).toBeGreaterThan(0);
    });

    it('should handle multiple features in a bucket', async () => {
      const { createBucketLineTileHandle }
        = await import('@/mvt/render/backend/bucket-line-backend');

      const bucketTile = createMockBucketTileWithMultipleFeatures();
      const style = createMockStyle('line');

      const handle = createBucketLineTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeDefined();
      expect(handle?.collections).toBeDefined();
      expect(handle?.collections.length).toBeGreaterThan(0);

      const collectionHandle = handle!.collections[0];
      expect(collectionHandle.polylineCount).toBe(2);
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
        type: type as 'line',
        familyId: `source/layer/${type}/0`,
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        stats: {
          type: type as 'line',
          featureCount: 1,
          byteLength: 100,
          polylineCount: type === 'line' ? 1 : undefined,
          totalVertexCount: type === 'line' ? 3 : undefined,
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
          ]),
          vertexCounts: new Uint32Array([3]),
          featureIds: new Float32Array([0, 0, 0]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test' },
              type: 'line',
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
        type: 'line' as const,
        familyId: 'source/layer/line/0',
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        stats: {
          type: 'line' as const,
          featureCount: 2,
          byteLength: 200,
          polylineCount: 2,
          totalVertexCount: 6,
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
          vertexCounts: new Uint32Array([3, 3]),
          featureIds: new Float32Array([0, 0, 0, 1, 1, 1]),
        },
        featureIndex: {
          entries: [
            {
              id: 1,
              properties: { name: 'test1' },
              type: 'line' as const,
            },
            {
              id: 2,
              properties: { name: 'test2' },
              type: 'line' as const,
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
