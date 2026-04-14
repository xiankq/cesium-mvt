import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { PrimitiveCollection, Resource } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { CesiumVectorTile } from '@/mvt/cesium-vector-tile';

const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nqkAAAAASUVORK5CYII=';

describe('cesiumVectorTile', () => {
  it('可以通过构造函数创建实例', () => {
    const vectorTile = new CesiumVectorTile();

    expect(vectorTile).toBeDefined();
    expect(vectorTile.isDestroyed()).toBe(false);

    vectorTile.destroy();
  });

  it('可以通过 crossSourceCollisions 选项关闭跨 source 碰撞', () => {
    const vectorTile = new CesiumVectorTile({
      crossSourceCollisions: false,
    });

    const renderManager = (vectorTile as any).coordinator.renderManager;
    expect(renderManager.crossSourceCollisions).toBe(false);

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

  it('可以通过 Resource 作为 fromUrl 入参创建实例', async () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('unexpected fetch');
    }));

    const fetchJson = vi
      .spyOn(Resource.prototype, 'fetchJson')
      .mockResolvedValue({
        layers: [
          {
            id: 'background',
            paint: {
              'background-color': '#123456',
            },
            type: 'background',
          },
        ],
        sources: {
          openmaptiles: {
            type: 'vector',
            url: '../tiles/planet.json',
          },
        },
        version: 8,
      } as StyleSpecification);

    const resource = new Resource({
      url: 'https://example.com/styles/basic/style.json',
    });

    const vectorTile = await CesiumVectorTile.fromUrl(resource);

    expect(vectorTile).toBeDefined();
    expect(vectorTile.isDestroyed()).toBe(false);
    expect(fetchJson).toHaveBeenCalledTimes(1);

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

  it('可以通过 updateStyle 方法更新样式', async () => {
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

    await vectorTile.updateStyle(style);
    expect(vectorTile.getStyle()).toBeDefined();

    vectorTile.destroy();
  });

  it('updateStyle 应该加载 sprite atlas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.endsWith('/sprite.json')) {
          return new Response(JSON.stringify({
            stripe: {
              height: 4,
              pixelRatio: 1,
              x: 0,
              y: 0,
              width: 8,
            },
          }));
        }

        if (url.endsWith('/sprite.png')) {
          return new Response(base64ToBytes(TEST_PNG_BASE64).buffer as ArrayBuffer);
        }

        throw new Error(`unexpected fetch url: ${url}`);
      }),
    );

    const vectorTile = new CesiumVectorTile();

    await vectorTile.updateStyle({
      version: 8,
      sources: {},
      sprite: 'https://example.com/styles/basic/sprite',
      layers: [],
    });

    type StyleWithSpriteAtlas = StyleSpecification & {
      spriteAtlas?: {
        getImage: (name: string) => unknown;
      };
    };

    const loadedStyle = vectorTile.getStyle() as StyleWithSpriteAtlas | undefined;
    expect(loadedStyle?.spriteAtlas?.getImage('stripe')).toBeDefined();

    vectorTile.destroy();
  });

  it('可以通过 setFeatureState 方法写入 feature-state', () => {
    const vectorTile = new CesiumVectorTile();
    const coordinator = {
      setFeatureState: vi.fn(),
      destroy: vi.fn(),
    };
    (vectorTile as any).coordinator = coordinator;

    vectorTile.setFeatureState({
      id: 1,
      sourceId: 'places',
    }, {
      selected: true,
    });

    expect(coordinator.setFeatureState).toHaveBeenCalledWith({
      id: 1,
      sourceId: 'places',
    }, {
      selected: true,
    });

    vectorTile.destroy();
  });

  it('可以通过 querySourceFeatures 方法委托给协调器', () => {
    const vectorTile = new CesiumVectorTile();
    const coordinator = {
      destroy: vi.fn(),
      querySourceFeatures: vi.fn(() => [{
        geometry: {
          coordinates: [0, 0],
          type: 'Point',
        },
        properties: {
          name: 'poi-a',
        },
        type: 'Feature',
      }]),
    };
    (vectorTile as any).coordinator = coordinator;

    const result = vectorTile.querySourceFeatures('places', {
      sourceLayer: 'poi',
    });

    expect(coordinator.querySourceFeatures).toHaveBeenCalledWith('places', {
      sourceLayer: 'poi',
    });
    expect(result).toHaveLength(1);

    vectorTile.destroy();
  });

  it('可以通过 queryRenderedFeatures 方法委托给协调器', () => {
    const vectorTile = new CesiumVectorTile();
    const coordinator = {
      destroy: vi.fn(),
      queryRenderedFeatures: vi.fn(() => [{
        geometry: {
          coordinates: [0, 0],
          type: 'Point',
        },
        layerId: 'poi',
        properties: {
          kind: 'cafe',
        },
        sourceId: 'places',
        sourceLayer: 'poi',
        type: 'Feature',
      }]),
    };
    (vectorTile as any).coordinator = coordinator;

    const result = vectorTile.queryRenderedFeatures({
      filter: ['==', ['get', 'kind'], 'cafe'],
    });

    expect(coordinator.queryRenderedFeatures).toHaveBeenCalledWith({
      filter: ['==', ['get', 'kind'], 'cafe'],
    });
    expect(result).toHaveLength(1);

    vectorTile.destroy();
  });

  it('prePassesUpdate 应该委托给协调器', () => {
    const vectorTile = new CesiumVectorTile();
    const coordinator = {
      destroy: vi.fn(),
      prePassesUpdate: vi.fn(),
    };
    (vectorTile as any).coordinator = coordinator;

    const frameState = {
      afterRender: [],
    };

    (vectorTile as any).prePassesUpdate(frameState);

    expect(coordinator.prePassesUpdate).toHaveBeenCalledWith(frameState);

    vectorTile.destroy();
  });

  it('prePassesUpdate 应该保留父类对子 primitive 的遍历', () => {
    const vectorTile = new CesiumVectorTile();
    const child = new PrimitiveCollection();
    const childPrePassesUpdate = vi.fn();
    (child as any).prePassesUpdate = childPrePassesUpdate;
    vectorTile.add(child);

    const coordinator = {
      destroy: vi.fn(),
      prePassesUpdate: vi.fn(),
    };
    (vectorTile as any).coordinator = coordinator;

    const frameState = {
      afterRender: [],
    };

    (vectorTile as any).prePassesUpdate(frameState);

    expect(childPrePassesUpdate).toHaveBeenCalledWith(frameState);
    expect(coordinator.prePassesUpdate).toHaveBeenCalledWith(frameState);

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

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
