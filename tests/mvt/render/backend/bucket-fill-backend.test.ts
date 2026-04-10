import { describe, expect, it } from 'vitest';
import {
  createMockEmptyBucketTile,
  createMockFillBucketTile,
  createMockFillBucketTileWithEmptyPositions,
  createMockFillBucketTileWithInvalidPositions,
  createMockFillBucketTileWithMissingLayer,
} from '../../../helpers/bucket-helpers';
import { createMockStyle } from '../../../helpers/style-helpers';

describe('bucket-fill-backend', () => {
  describe('createBucketFillTileHandle', () => {
    describe('正常流程', () => {
      it('应该从bucket tile创建填充瓦片句柄', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTile();
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.key).toBe('source/0/0/0');
        expect(handle?.collections).toBeDefined();
        expect(handle?.collections.length).toBeGreaterThan(0);
        expect(handle?.byteLength).toBeGreaterThan(0);
      });

      it('应该为空bucket tile返回undefined', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockEmptyBucketTile();
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });

      it('应该处理bucket中的多个要素', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTile({ featureCount: 2 });
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toBeDefined();
        expect(handle?.collections.length).toBeGreaterThan(0);

        const collectionHandle = handle!.collections[0];
        expect(collectionHandle.polygonCount).toBe(2);
        expect(collectionHandle.collection).toBeDefined();
        expect(collectionHandle.byteLength).toBeGreaterThan(0);
        expect(collectionHandle.layerId).toBe('layer1');
      });
    });

    describe('边界条件', () => {
      it('应该处理空positions数组', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTileWithEmptyPositions();
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });

      it('应该处理包含NaN坐标的positions', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTileWithInvalidPositions();
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });

      it('应该处理layer不存在的情况', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTileWithMissingLayer();
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });
    });

    describe('数据验证', () => {
      it('应该正确计算byteLength', async () => {
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTile({ featureCount: 3 });
        const style = createMockStyle('fill');

        const handle = createBucketFillTileHandle({
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
        const { createBucketFillTileHandle }
          = await import('@/mvt/render/backend/bucket-fill-backend');

        const bucketTile = createMockFillBucketTile({ layerId: 'custom-layer' });
        const style = createMockStyle('fill', { layerId: 'custom-layer' });

        const handle = createBucketFillTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        const collection = handle!.collections[0];
        expect(collection.layerId).toBe('custom-layer');
        expect(collection.polygonCount).toBeGreaterThan(0);
        expect(collection.collection).toBeDefined();
      });
    });
  });
});
