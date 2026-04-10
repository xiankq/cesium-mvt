import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import { Event, PrimitiveCollection, WebMercatorTilingScheme } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { SceneLayer } from '@/mvt/scene-layer';
import { createStyleSet } from '@/mvt/style/style-set';

function createSceneStub(overrides: Partial<Scene> = {}) {
  return {
    camera: {
      computeViewRectangle: () => undefined,
    },
    canvas: {
      clientWidth: 256,
      width: 256,
    },
    postRender: new Event(),
    preRender: new Event(),
    primitives: new PrimitiveCollection(),
    requestRender: vi.fn(),
    ...overrides,
  } as unknown as Scene;
}

function flushAsyncWork() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('scene-layer-render', () => {
  it('mounts and caches circle tile collections on the scene root', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
          },
        },
      },
      layers: [
        {
          id: 'poi',
          type: 'circle',
          source: 'places',
          paint: {
            'circle-color': '#0088ff',
            'circle-radius': 6,
          },
        },
      ],
    };

    sceneLayer.updateStyle(createStyleSet(style));
    const firstHandle = await sceneLayer.ensureRenderedTile('places', 0, 0, 0);

    expect(firstHandle).toBeDefined();
    expect(firstHandle?.circles?.collections).toHaveLength(1);
    expect(firstHandle?.circles?.collections[0]?.collection.primitiveCount).toBe(1);
    expect(firstHandle?.byteLength).toBeGreaterThan(0);

    const root = scene.primitives.get(0) as PrimitiveCollection;
    expect(root.length).toBe(1);
    expect(await sceneLayer.ensureRenderedTile('places', 0, 0, 0)).toBe(firstHandle);

    sceneLayer.destroy();
  });

  it('clears mounted circle collections when the style changes', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const circleStyle: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {},
              },
            ],
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
    const lineStyle: StyleSpecification = {
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
          id: 'poi-line',
          type: 'line',
          source: 'places',
        },
      ],
    };

    sceneLayer.updateStyle(createStyleSet(circleStyle));
    await sceneLayer.ensureRenderedTile('places', 0, 0, 0);

    const root = scene.primitives.get(0) as PrimitiveCollection;
    expect(root.length).toBe(1);

    sceneLayer.updateStyle(createStyleSet(lineStyle));

    expect(root.length).toBe(0);

    sceneLayer.destroy();
  });

  it('deduplicates in-flight rendered tile creation for the same tile', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    const [firstHandle, secondHandle] = await Promise.all([
      sceneLayer.ensureRenderedTile('places', 0, 0, 0),
      sceneLayer.ensureRenderedTile('places', 0, 0, 0),
    ]);

    const root = scene.primitives.get(0) as PrimitiveCollection;
    expect(firstHandle).toBe(secondHandle);
    expect(root.length).toBe(1);

    sceneLayer.destroy();
  });

  it('marks a requested tile hint as shown after rendering completes', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    const renderTile = sceneLayer.getRenderTile('places', 0, 0, 0);
    const pendingHint = sceneLayer.requestTileHint(0, 0, 0);

    expect(sceneLayer.tileManager.getTile(renderTile.key)).toMatchObject({
      blockers: {
        parsing: false,
        pick: false,
        placement: false,
        requesting: true,
        uploading: false,
      },
      key: renderTile.key,
    });

    await pendingHint;

    expect(sceneLayer.tileManager.getTile(renderTile.key)).toMatchObject({
      blockers: {
        parsing: false,
        pick: false,
        placement: false,
        requesting: false,
        uploading: false,
      },
      eligibleForUnloading: false,
      key: renderTile.key,
      state: 'shown',
    });

    sceneLayer.destroy();
  });

  it('does not request another render when a visible cached tile stays visible', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    await sceneLayer.requestTileHint(0, 0, 0);

    const requestRender = vi.mocked(scene.requestRender);
    requestRender.mockClear();

    await sceneLayer.requestTileHint(0, 0, 0);

    expect(requestRender).not.toHaveBeenCalled();

    sceneLayer.destroy();
  });

  it('does not request render for resolved tiles with no mounted geometry', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        shapes: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {},
              },
            ],
          },
        },
      },
      layers: [
        {
          id: 'road',
          type: 'line',
          source: 'shapes',
        },
      ],
    };

    sceneLayer.updateStyle(createStyleSet(style));

    const requestRender = vi.mocked(scene.requestRender);
    requestRender.mockClear();

    await sceneLayer.requestTileHint(0, 0, 0);

    expect(requestRender).not.toHaveBeenCalled();

    sceneLayer.destroy();
  });

  it('requests and renders visible tiles from the current camera view during preRender', async () => {
    const tilingScheme = new WebMercatorTilingScheme();
    const scene = createSceneStub({
      camera: {
        computeViewRectangle: () => tilingScheme.rectangle,
      } as Scene['camera'],
    });
    const sceneLayer = new SceneLayer(scene, {
      maximumLevel: 0,
      minimumLevel: 0,
      tilingScheme,
    });
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    scene.preRender.raiseEvent();
    await flushAsyncWork();

    const renderTile = sceneLayer.getRenderTile('places', 0, 0, 0);
    const root = scene.primitives.get(0) as PrimitiveCollection;

    expect(sceneLayer.tileManager.getTile(renderTile.key)).toMatchObject({
      eligibleForUnloading: false,
      key: renderTile.key,
      state: 'shown',
    });
    expect(root.length).toBe(1);

    sceneLayer.destroy();
  });

  it('skips a no-op frame update when the view and tile state stay unchanged', async () => {
    const tilingScheme = new WebMercatorTilingScheme();
    const scene = createSceneStub({
      camera: {
        computeViewRectangle: () => tilingScheme.rectangle,
      } as Scene['camera'],
    });
    const sceneLayer = new SceneLayer(scene, {
      maximumLevel: 0,
      minimumLevel: 0,
      tilingScheme,
    });
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    scene.preRender.raiseEvent();
    await flushAsyncWork();
    scene.postRender.raiseEvent();

    const renderTile = sceneLayer.getRenderTile('places', 0, 0, 0);
    const frameNumber = sceneLayer.tileManager.getCurrentFrame();

    scene.preRender.raiseEvent();
    scene.postRender.raiseEvent();

    expect(sceneLayer.tileManager.getCurrentFrame()).toBe(frameNumber);
    expect(sceneLayer.tileManager.getTile(renderTile.key)).toMatchObject({
      eligibleForUnloading: false,
      key: renderTile.key,
      state: 'shown',
    });

    sceneLayer.destroy();
  });

  it('keeps a ready parent tile shown while visible child tiles are still loading', async () => {
    const tilingScheme = new WebMercatorTilingScheme();
    let viewRectangle = tilingScheme.rectangle;
    const scene = createSceneStub({
      camera: {
        computeViewRectangle: () => viewRectangle,
      } as Scene['camera'],
    });
    const sceneLayer = new SceneLayer(scene, {
      maximumLevel: 1,
      minimumLevel: 0,
      tilingScheme,
    });
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [-90, 60],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    await sceneLayer.requestTileHint(0, 0, 0);

    const rootHandle = await sceneLayer.ensureRenderedTile('places', 0, 0, 0);
    const rootCollection = rootHandle.circles?.collections[0]?.collection;
    const sourceCache = sceneLayer.getSourceCache('places');
    if (!sourceCache) {
      throw new Error('Missing source cache for places.');
    }

    const originalRequestTile = sourceCache.requestTile.bind(sourceCache);
    let resolveChildTileRequest: (() => void) | undefined;
    sourceCache.requestTile = (coordinate) => {
      if (coordinate.level !== 1) {
        return originalRequestTile(coordinate);
      }

      return new Promise((resolve) => {
        resolveChildTileRequest = () => {
          void originalRequestTile(coordinate).then(resolve);
        };
      });
    };

    viewRectangle = tilingScheme.tileXYToRectangle(0, 0, 1);
    scene.preRender.raiseEvent();
    await flushAsyncWork();
    scene.postRender.raiseEvent();

    const childRenderTile = sceneLayer.getRenderTile('places', 1, 0, 0);

    expect(rootCollection?.show).toBe(true);
    expect(sceneLayer.tileManager.getTile(rootHandle.key)).toMatchObject({
      eligibleForUnloading: false,
      key: rootHandle.key,
      state: 'shown',
    });
    expect(sceneLayer.tileManager.getTile(childRenderTile.key)).toMatchObject({
      blockers: {
        parsing: false,
        pick: false,
        placement: false,
        requesting: true,
        uploading: false,
      },
      key: childRenderTile.key,
    });

    resolveChildTileRequest?.();
    await flushAsyncWork();
    scene.preRender.raiseEvent();
    await flushAsyncWork();
    scene.postRender.raiseEvent();

    const childHandle = await sceneLayer.ensureRenderedTile('places', 1, 0, 0);
    const childCollection = childHandle.circles?.collections[0]?.collection;

    expect(childCollection?.show).toBe(true);
    expect(rootCollection?.show).toBe(false);

    sceneLayer.destroy();
  });

  it('does not compile child render plans before their in-flight requests resolve', async () => {
    const tilingScheme = new WebMercatorTilingScheme();
    let viewRectangle = tilingScheme.rectangle;
    const scene = createSceneStub({
      camera: {
        computeViewRectangle: () => viewRectangle,
      } as Scene['camera'],
    });
    const sceneLayer = new SceneLayer(scene, {
      maximumLevel: 1,
      minimumLevel: 0,
      tilingScheme,
    });
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [-90, 60],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));
    await sceneLayer.requestTileHint(0, 0, 0);

    const sourceCache = sceneLayer.getSourceCache('places');
    if (!sourceCache) {
      throw new Error('Missing source cache for places.');
    }

    const originalRequestTile = sourceCache.requestTile.bind(sourceCache);
    sourceCache.requestTile = (coordinate) => {
      if (coordinate.level !== 1) {
        return originalRequestTile(coordinate);
      }

      return new Promise(() => {});
    };

    viewRectangle = tilingScheme.tileXYToRectangle(0, 0, 1);
    scene.preRender.raiseEvent();
    await flushAsyncWork();

    expect((sceneLayer as any).renderTiles.size).toBe(1);

    sceneLayer.destroy();
  });

  it('hides mounted collections for tiles that leave the current frame show set and shows them again when requested', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));

    scene.preRender.raiseEvent();
    await sceneLayer.requestTileHint(0, 0, 0);
    scene.postRender.raiseEvent();

    const handle = await sceneLayer.ensureRenderedTile('places', 0, 0, 0);
    const collection = handle.circles?.collections[0]?.collection;
    const root = scene.primitives.get(0) as PrimitiveCollection;

    expect(collection?.show).toBe(true);
    expect(root.length).toBe(1);

    scene.preRender.raiseEvent();
    scene.postRender.raiseEvent();

    expect(collection?.show).toBe(false);
    expect(root.length).toBe(1);

    scene.preRender.raiseEvent();
    await sceneLayer.requestTileHint(0, 0, 0);
    scene.postRender.raiseEvent();

    expect(collection?.show).toBe(true);
    expect(root.length).toBe(1);

    sceneLayer.destroy();
  });

  it('unloads hidden tile collections after they stay untouched for another frame', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
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

    sceneLayer.updateStyle(createStyleSet(style));

    scene.preRender.raiseEvent();
    await sceneLayer.requestTileHint(0, 0, 0);
    scene.postRender.raiseEvent();

    const renderTile = sceneLayer.getRenderTile('places', 0, 0, 0);
    const root = scene.primitives.get(0) as PrimitiveCollection;

    expect(root.length).toBe(1);

    scene.preRender.raiseEvent();
    scene.postRender.raiseEvent();

    expect(root.length).toBe(1);
    expect(sceneLayer.tileManager.getTile(renderTile.key)).toMatchObject({
      eligibleForUnloading: false,
      state: 'hidden',
    });

    scene.preRender.raiseEvent();
    scene.postRender.raiseEvent();

    expect(root.length).toBe(0);
    expect(sceneLayer.tileManager.getTile(renderTile.key)).toMatchObject({
      eligibleForUnloading: true,
      state: 'hidden',
    });

    sceneLayer.destroy();
  });

  it('mounts line and fill tile collections on the scene root and clears them on style change', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        shapes: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [[-10, 0], [10, 0]],
                },
                properties: {
                  kind: 'road',
                },
              },
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [[[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]]],
                },
                properties: {
                  kind: 'park',
                },
              },
            ],
          },
        },
      },
      layers: [
        {
          id: 'road',
          type: 'line',
          source: 'shapes',
          paint: {
            'line-width': 3,
          },
        },
        {
          id: 'land',
          type: 'fill',
          source: 'shapes',
          paint: {
            'fill-color': '#00aa00',
          },
        },
      ],
    };
    const emptyStyle: StyleSpecification = {
      version: 8,
      sources: style.sources,
      layers: [],
    };

    sceneLayer.updateStyle(createStyleSet(style));
    const handle = await sceneLayer.ensureRenderedTile('shapes', 0, 0, 0);

    expect(handle).toBeDefined();
    expect(handle?.lines?.collections).toHaveLength(1);
    expect(handle?.fills?.collections).toHaveLength(1);
    expect(handle?.byteLength).toBeGreaterThan(0);

    const root = scene.primitives.get(0) as PrimitiveCollection;
    expect(root.length).toBe(2);

    sceneLayer.updateStyle(createStyleSet(emptyStyle));

    expect(root.length).toBe(0);

    sceneLayer.destroy();
  });
});
