import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { PrimitiveCollection } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { CesiumVectorTile } from '@/mvt/cesium-vector-tile';

describe('cesiumVectorTile', () => {
  it('可以通过构造函数创建实例', () => {
    const vectorTile = new CesiumVectorTile();

    expect(vectorTile).toBeDefined();
    expect(vectorTile.isDestroyed()).toBe(false);

    vectorTile.destroy();
  });

  it('可以通过 fromUrl 静态方法创建实例', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        version: 8,
        sources: {
          openmaptiles: {
            type: 'vector',
            url: '../tiles/planet.json',
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#123456',
            },
          },
        ],
      }))),
    );

    const vectorTile = await CesiumVectorTile.fromUrl('https://example.com/styles/basic/style.json');

    expect(vectorTile).toBeDefined();
    expect(vectorTile.isDestroyed()).toBe(false);

    vectorTile.destroy();
  });

  it('可以被添加到 scene.primitives', () => {
    const primitives = new PrimitiveCollection();
    const vectorTile = new CesiumVectorTile();

    primitives.add(vectorTile);
    expect(primitives.contains(vectorTile)).toBe(true);

    primitives.remove(vectorTile);
    expect(primitives.contains(vectorTile)).toBe(false);
    expect(vectorTile.isDestroyed()).toBe(true);
  });

  it('可以通过 updateStyle 方法更新样式', () => {
    const vectorTile = new CesiumVectorTile();

    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'poi',
          type: 'circle',
          source: 'places',
        },
      ],
    };

    vectorTile.updateStyle(style);
    expect(vectorTile.getStyle()).toBeDefined();

    vectorTile.destroy();
  });

  it('销毁时清理所有资源', () => {
    const vectorTile = new CesiumVectorTile();

    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'poi',
          type: 'circle',
          source: 'places',
        },
      ],
    };

    vectorTile.updateStyle(style);
    vectorTile.destroy();

    expect(vectorTile.isDestroyed()).toBe(true);
  });

  it('fromUrl 失败时正确处理错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' })),
    );

    await expect(
      CesiumVectorTile.fromUrl('https://example.com/styles/not-found.json'),
    ).rejects.toThrow();
  });
});
