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
  } as unknown as Scene;
}

describe('scene-layer', () => {
  it('reconciles source caches when the style changes', () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const firstStyle: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [],
    };
    const secondStyle: StyleSpecification = {
      version: 8,
      sources: {
        labels: {
          type: 'vector',
          tiles: ['https://tiles.example.com/labels/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [],
    };

    sceneLayer.updateStyle(createStyleSet(firstStyle));
    const baseCache = sceneLayer.getSourceCache('base');

    expect(baseCache).toBeDefined();
    expect(baseCache?.isDestroyed()).toBe(false);

    sceneLayer.updateStyle(createStyleSet(secondStyle));

    expect(baseCache?.isDestroyed()).toBe(true);
    expect(sceneLayer.getSourceCache('base')).toBeUndefined();
    expect(sceneLayer.getSourceCache('labels')).toBeDefined();

    sceneLayer.destroy();
  });
});
