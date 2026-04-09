import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import { Event, PrimitiveCollection } from 'cesium';
import { describe, expect, it } from 'vitest';
import { SceneLayer } from '../../src/mvt/scene-layer';
import { createStyleSet } from '../../src/mvt/style/style-set';

function createSceneStub() {
  return {
    postRender: new Event(),
    preRender: new Event(),
    primitives: new PrimitiveCollection(),
    requestRender() {},
  } as unknown as Scene;
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
