import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
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

      it('应该按 filter 和数据驱动样式分别渲染同一 family 的要素', async () => {
        const { BufferPoint, BufferPointMaterial } = await import('cesium');
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile({
          featureCount: 2,
          layerId: 'poi-base',
        });
        const bucket = bucketTile.buckets[0]!;
        bucket.layerIds = ['poi-base', 'poi-highlight'];
        bucket.featureIndex.entries[0]!.properties = {
          color: '#112233',
          kind: 'base',
          radius: 3,
        };
        bucket.featureIndex.entries[1]!.properties = {
          color: '#445566',
          kind: 'highlight',
          radius: 7,
        };

        const style = {
          version: 8 as const,
          sources: {},
          layers: [
            {
              'filter': ['==', ['get', 'kind'], 'base'],
              'id': 'poi-base',
              'paint': {
                'circle-color': ['get', 'color'],
                'circle-radius': ['get', 'radius'],
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'circle' as const,
            },
            {
              'filter': ['==', ['get', 'kind'], 'highlight'],
              'id': 'poi-highlight',
              'paint': {
                'circle-color': ['get', 'color'],
                'circle-radius': ['get', 'radius'],
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'circle' as const,
            },
          ],
        } as StyleSpecification;

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toHaveLength(2);

        const baseCollection = handle!.collections.find(collection => collection.layerId === 'poi-base');
        const highlightCollection = handle!.collections.find(collection => collection.layerId === 'poi-highlight');
        expect(baseCollection).toBeDefined();
        expect(highlightCollection).toBeDefined();
        expect(baseCollection?.collection.primitiveCount).toBe(1);
        expect(highlightCollection?.collection.primitiveCount).toBe(1);

        const point = new BufferPoint();
        const material = new BufferPointMaterial();

        baseCollection!.collection.get(0, point);
        const baseMaterial = point.getMaterial(material) as unknown as {
          color: {
            alpha: number;
            blue: number;
            green: number;
            red: number;
          };
          size: number;
        };
        expect(baseMaterial.color.red).toBeCloseTo(0x11 / 255, 4);
        expect(baseMaterial.color.green).toBeCloseTo(0x22 / 255, 4);
        expect(baseMaterial.color.blue).toBeCloseTo(0x33 / 255, 4);
        expect(baseMaterial.size).toBe(6);

        highlightCollection!.collection.get(0, point);
        const highlightMaterial = point.getMaterial(material) as unknown as {
          color: {
            alpha: number;
            blue: number;
            green: number;
            red: number;
          };
          size: number;
        };
        expect(highlightMaterial.color.red).toBeCloseTo(0x44 / 255, 4);
        expect(highlightMaterial.color.green).toBeCloseTo(0x55 / 255, 4);
        expect(highlightMaterial.color.blue).toBeCloseTo(0x66 / 255, 4);
        expect(highlightMaterial.size).toBe(14);
      });

      it('应该读取 feature-state 过滤要素', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile({
          featureCount: 2,
          layerId: 'selected-layer',
        });
        bucketTile.buckets[0]!.layerIds = ['selected-layer'];

        const style = {
          version: 8 as const,
          sources: {},
          layers: [
            {
              'filter': ['==', ['feature-state', 'selected'], true],
              'id': 'selected-layer',
              'paint': {
                'circle-color': '#112233',
                'circle-radius': 5,
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'circle' as const,
            },
          ],
        } as StyleSpecification;

        const handle = createBucketCircleTileHandle({
          bucketTile,
          featureStateResolver: ({ id }) => ({
            selected: id === 1,
          }),
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toHaveLength(1);
        expect(handle?.collections[0]?.pointCount).toBe(1);
      });

      it('应该为同一circle bucket的多个layerId分别创建collection', async () => {
        const { createBucketCircleTileHandle }
          = await import('@/mvt/render/backend/bucket-circle-backend');

        const bucketTile = createMockCircleBucketTile({ layerId: 'poi-base' });
        bucketTile.buckets[0]!.layerIds = ['poi-base', 'poi-highlight'];
        const style: StyleSpecification = {
          version: 8 as const,
          sources: {},
          layers: [
            {
              'id': 'poi-base',
              'type': 'circle' as const,
              'source': 'source',
              'source-layer': 'layer',
              'paint': {
                'circle-color': '#0000ff',
              },
            },
            {
              'id': 'poi-highlight',
              'type': 'circle' as const,
              'source': 'source',
              'source-layer': 'layer',
              'paint': {
                'circle-color': '#ff00ff',
              },
            },
          ],
        };

        const handle = createBucketCircleTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toHaveLength(2);
        expect(handle?.collections.map(collection => collection.layerId)).toEqual([
          'poi-base',
          'poi-highlight',
        ]);
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
