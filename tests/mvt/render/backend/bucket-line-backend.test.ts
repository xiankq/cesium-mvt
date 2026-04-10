import { describe, expect, it } from 'vitest';
import {
  createMockEmptyBucketTile,
  createMockLineBucketTile,
  createMockLineBucketTileWithEmptyPositions,
  createMockLineBucketTileWithInsufficientPositions,
  createMockLineBucketTileWithInvalidPositions,
  createMockLineBucketTileWithMissingLayer,
  createMockLineBucketTileWithSingleVertex,
} from '../../../helpers/bucket-helpers';
import { createMockStyle } from '../../../helpers/style-helpers';

describe('bucket-line-backend', () => {
  describe('createBucketLineTileHandle', () => {
    describe('正常流程', () => {
      it('应该为空bucket tile返回undefined', async () => {
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

      it('应该从bucket tile创建线瓦片句柄', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile();
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
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
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile({ featureCount: 2 });
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
        expect(collectionHandle.byteLength).toBeGreaterThan(0);
        expect(collectionHandle.layerId).toBe('layer1');
      });
    });

    describe('边界条件', () => {
      it('应该处理空positions数组', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTileWithEmptyPositions();
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });

      it('应该处理单顶点线（顶点数少于2）', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTileWithSingleVertex();
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toBeDefined();
      });

      it('应该处理包含NaN坐标的positions', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTileWithInvalidPositions();
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toBeDefined();
      });

      it('应该处理positions长度不足的情况', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTileWithInsufficientPositions();
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toBeDefined();
      });

      it('应该处理layer不存在的情况', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTileWithMissingLayer();
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeUndefined();
      });
    });

    describe('数据验证', () => {
      it('应该正确计算byteLength', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile({ featureCount: 3 });
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
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
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile({ layerId: 'custom-layer' });
        const style = createMockStyle('line', { layerId: 'custom-layer' });

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        const collection = handle!.collections[0];
        expect(collection.layerId).toBe('custom-layer');
        expect(collection.polylineCount).toBeGreaterThan(0);
        expect(collection.collection).toBeDefined();
      });
    });
  });
});
