import { describe, expect, it } from 'vitest';
import {
  createMockCircleBucketTile,
  createMockCircleBucketTileWithEmptyPositions,
  createMockCircleBucketTileWithInvalidPositions,
  createMockCircleBucketTileWithMissingLayer,
  createMockEmptyBucketTile,
} from '../../../helpers/bucket-helpers';
import { createMockStyle } from '../../../helpers/style-helpers';

describe('bucket-circle-backend', () => {
  describe('createBucketCircleTileHandle', () => {
    describe('正常流程', () => {
      it('应该为空bucket tile返回undefined', async () => {
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

      it('应该从bucket tile创建圆形瓦片句柄', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile();
        const style = createMockStyle('circle');

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.key).toBe('source/0/0/0');
        expect(handle?.collections).toBeDefined();
        expect(handle?.collections.length).toBeGreaterThan(0);
        expect(handle?.byteLength).toBeGreaterThan(0);
      });

      it('应该处理bucket中的多个要素', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile({ featureCount: 2 });
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
        expect(collectionHandle.byteLength).toBeGreaterThan(0);
        expect(collectionHandle.layerId).toBe('layer1');
      });
    });

    describe('边界条件', () => {
      it('应该处理空positions数组', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTileWithEmptyPositions();
        const style = createMockStyle('circle');

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });

      it('应该处理包含NaN坐标的positions', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTileWithInvalidPositions();
        const style = createMockStyle('circle');

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toBeDefined();
        expect(handle?.collections.length).toBeGreaterThan(0);
      });

      it('应该处理layer不存在的情况', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTileWithMissingLayer();
        const style = createMockStyle('circle');

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });
    });

    describe('数据验证', () => {
      it('应该正确计算byteLength', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile({ featureCount: 3 });
        const style = createMockStyle('circle');

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.byteLength).toBeGreaterThan(0);

        const collectionByteLength = handle!.collections.reduce(
          (total, c) => total + c.byteLength,
          0,
        );
        expect(collectionByteLength).toBe(handle!.byteLength);
      });

      it('应该正确设置collection属性', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile({ layerId: 'custom-layer' });
        const style = createMockStyle('circle', { layerId: 'custom-layer' });

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        const collection = handle!.collections[0];
        expect(collection.layerId).toBe('custom-layer');
        expect(collection.pointCount).toBeGreaterThan(0);
        expect(collection.collection).toBeDefined();
      });
    });
  });
});
