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
});
