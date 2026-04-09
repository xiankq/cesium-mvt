import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import { Event, PrimitiveCollection } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { attachStyleLayer } from '../../src/mvt/attach-layer';

function createSceneStub() {
  return {
    postRender: new Event(),
    preRender: new Event(),
    primitives: new PrimitiveCollection(),
    requestRender: vi.fn(),
  } as unknown as Scene;
}

describe('attach-style-layer', () => {
  it('destroys the provider when the layer binding is cleaned up', () => {
    const scene = createSceneStub();
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [],
    };
    const layer = {};
    const imageryLayers = {
      addImageryProvider: vi.fn(() => layer),
      remove: vi.fn(() => true),
    };

    const binding = attachStyleLayer({
      imageryLayers,
      scene,
      style,
    });

    expect(scene.primitives.length).toBe(1);
    expect(scene.preRender.numberOfListeners).toBe(1);
    expect(scene.postRender.numberOfListeners).toBe(1);

    binding.destroy();

    expect(imageryLayers.remove).toHaveBeenCalledWith(layer);
    expect(binding.provider.isDestroyed()).toBe(true);
    expect(scene.primitives.length).toBe(0);
    expect(scene.preRender.numberOfListeners).toBe(0);
    expect(scene.postRender.numberOfListeners).toBe(0);
  });
});
