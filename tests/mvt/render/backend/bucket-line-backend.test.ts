import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
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

      it('应该兼容带 styleEpoch 后缀的 bucket tile key', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile({
          tileKey: 'openmaptiles/8/205/114@1',
        });
        const style = createMockStyle('line');

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.key).toBe('openmaptiles/8/205/114@1');
        expect(handle?.collections.length).toBeGreaterThan(0);
      });

      it('应该按 filter 和数据驱动样式分别渲染同一 family 的要素', async () => {
        const {
          BufferPolyline,
          BufferPolylineCollection,
          BufferPolylineMaterial,
        } = await import('cesium');
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile({
          featureCount: 2,
          layerId: 'road-base',
        });
        const bucket = bucketTile.buckets[0]!;
        bucket.layerIds = ['road-base', 'road-casing'];
        bucket.featureIndex.entries[0]!.properties = {
          color: '#112233',
          kind: 'base',
          width: 2,
        };
        bucket.featureIndex.entries[1]!.properties = {
          color: '#445566',
          kind: 'casing',
          width: 4,
        };

        const style = {
          version: 8 as const,
          sources: {},
          layers: [
            {
              'filter': ['==', ['get', 'kind'], 'base'],
              'id': 'road-base',
              'paint': {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'width'],
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'line' as const,
            },
            {
              'filter': ['==', ['get', 'kind'], 'casing'],
              'id': 'road-casing',
              'paint': {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'width'],
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'line' as const,
            },
          ],
        } as StyleSpecification;

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toHaveLength(2);

        const baseCollection = handle!.collections.find(collection => collection.layerId === 'road-base');
        const casingCollection = handle!.collections.find(collection => collection.layerId === 'road-casing');
        expect(baseCollection).toBeDefined();
        expect(casingCollection).toBeDefined();
        expect(baseCollection?.collection).toBeInstanceOf(BufferPolylineCollection);
        expect(casingCollection?.collection).toBeInstanceOf(BufferPolylineCollection);
        if (baseCollection?.collection instanceof BufferPolylineCollection) {
          expect(baseCollection.collection.primitiveCount).toBe(1);
        }
        if (casingCollection?.collection instanceof BufferPolylineCollection) {
          expect(casingCollection.collection.primitiveCount).toBe(1);
        }

        const polyline = new BufferPolyline();
        const material = new BufferPolylineMaterial();

        baseCollection!.collection.get(0, polyline);
        const baseMaterial = polyline.getMaterial(material) as unknown as {
          color: {
            alpha: number;
            blue: number;
            green: number;
            red: number;
          };
          width: number;
        };
        expect(baseMaterial.color.red).toBeCloseTo(0x11 / 255, 4);
        expect(baseMaterial.color.green).toBeCloseTo(0x22 / 255, 4);
        expect(baseMaterial.color.blue).toBeCloseTo(0x33 / 255, 4);
        expect(baseMaterial.width).toBe(2);

        casingCollection!.collection.get(0, polyline);
        const casingMaterial = polyline.getMaterial(material) as unknown as {
          color: {
            alpha: number;
            blue: number;
            green: number;
            red: number;
          };
          width: number;
        };
        expect(casingMaterial.color.red).toBeCloseTo(0x44 / 255, 4);
        expect(casingMaterial.color.green).toBeCloseTo(0x55 / 255, 4);
        expect(casingMaterial.color.blue).toBeCloseTo(0x66 / 255, 4);
        expect(casingMaterial.width).toBe(4);
      });

      it('应该为带 line-dasharray 的线使用 PolylineCollection', async () => {
        const { Material, PolylineCollection } = await import('cesium');
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile();
        const style: StyleSpecification = {
          version: 8 as const,
          sources: {},
          layers: [
            {
              'id': 'layer1',
              'paint': {
                'line-color': '#00ff00',
                'line-dasharray': ['literal', [2, 1]],
                'line-width': 2,
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'line',
            },
          ],
        };

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        const collection = handle?.collections[0]?.collection;
        expect(collection).toBeInstanceOf(PolylineCollection);
        if (collection instanceof PolylineCollection) {
          const polyline = collection.get(0);
          expect(polyline.material.type).toBe(Material.PolylineDashType);
          expect(polyline.material.uniforms.dashLength).toBe(6);
          expect(polyline.material.uniforms.dashPattern).not.toBe(255);
        }
      });

      it('应该为带 line-pattern 的线使用图案材质', async () => {
        const { PolylineCollection } = await import('cesium');
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile();
        const style = {
          version: 8 as const,
          sources: {},
          spriteAtlas: {
            getImage(name: string) {
              if (name !== 'stripe') {
                return undefined;
              }

              return {
                height: 4,
                image: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E',
                pixelRatio: 1,
                width: 8,
              };
            },
          },
          layers: [
            {
              'id': 'layer1',
              'paint': {
                'line-color': '#00ff00',
                'line-pattern': 'stripe',
                'line-width': 2,
              },
              'source': 'source',
              'source-layer': 'layer',
              'type': 'line',
            },
          ],
        } as StyleSpecification & {
          spriteAtlas: {
            getImage: (name: string) => {
              height: number;
              image: string;
              pixelRatio: number;
              width: number;
            } | undefined;
          };
        };

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        const collection = handle?.collections[0]?.collection;
        expect(collection).toBeInstanceOf(PolylineCollection);
        if (collection instanceof PolylineCollection) {
          const polyline = collection.get(0);
          expect(polyline.material.type).toBe('PolylineImagePattern');
          expect(polyline.material.uniforms.image).toContain('data:image/svg+xml');
          expect(polyline.material.uniforms.imageSize.x).toBe(8);
          expect(polyline.material.uniforms.imageSize.y).toBe(4);
        }
      });

      it('应该为同一line bucket的多个layerId分别创建collection', async () => {
        const { createBucketLineTileHandle }
          = await import('@/mvt/render/backend/bucket-line-backend');

        const bucketTile = createMockLineBucketTile({ layerId: 'road-base' });
        bucketTile.buckets[0]!.layerIds = ['road-base', 'road-casing'];
        const style: StyleSpecification = {
          version: 8 as const,
          sources: {},
          layers: [
            {
              'id': 'road-base',
              'type': 'line' as const,
              'source': 'source',
              'source-layer': 'layer',
              'paint': {
                'line-color': '#00ff00',
              },
            },
            {
              'id': 'road-casing',
              'type': 'line' as const,
              'source': 'source',
              'source-layer': 'layer',
              'paint': {
                'line-color': '#ff0000',
              },
            },
          ],
        };

        const handle = createBucketLineTileHandle({
          bucketTile,
          style,
        });

        expect(handle).toBeDefined();
        expect(handle?.collections).toHaveLength(2);
        expect(handle?.collections.map(collection => collection.layerId)).toEqual([
          'road-base',
          'road-casing',
        ]);
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
