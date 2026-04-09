import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import { Event, PrimitiveCollection } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleImageryProvider } from '../../src/mvt/imagery-provider';

function createSceneStub() {
  return {
    postRender: new Event(),
    preRender: new Event(),
    primitives: new PrimitiveCollection(),
    requestRender: vi.fn(),
  } as unknown as Scene;
}

function flushAsyncWork() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('style-imagery-provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a scene layer, reuses the background image, and detaches on destroy', async () => {
    const scene = createSceneStub();
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': 'rgba(17,34,51,0.4)',
          },
        },
      ],
    };

    const provider = new StyleImageryProvider({
      scene,
      style,
    });

    expect(scene.primitives.length).toBe(1);
    expect(scene.preRender.numberOfListeners).toBe(1);
    expect(scene.postRender.numberOfListeners).toBe(1);

    const firstImage = await provider.requestImage(0, 0, 0);
    const secondImage = await provider.requestImage(1, 1, 1);

    expect(firstImage).toBe(secondImage);
    expect(scene.requestRender).toHaveBeenCalledTimes(1);

    provider.destroy();

    expect(provider.isDestroyed()).toBe(true);
    expect(scene.primitives.length).toBe(0);
    expect(scene.preRender.numberOfListeners).toBe(0);
    expect(scene.postRender.numberOfListeners).toBe(0);
  });

  it('rejects requestImage when the style request fails', async () => {
    const scene = createSceneStub();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      })),
    );

    const provider = new StyleImageryProvider({
      scene,
      style: 'https://example.com/styles/missing.json',
    });
    provider.errorEvent.addEventListener(onError);

    await expect(provider.requestImage(0, 0, 0)).rejects.toThrow(
      'Failed to load style: https://example.com/styles/missing.json',
    );
    expect(onError).toHaveBeenCalledTimes(1);

    provider.destroy();
  });

  it('uses requestImage as a tile hint to mount vector primitives', async () => {
    const scene = createSceneStub();
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

    const provider = new StyleImageryProvider({
      scene,
      style,
    });

    await provider.requestImage(0, 0, 0);
    await flushAsyncWork();

    const root = scene.primitives.get(0) as PrimitiveCollection;
    expect(root.length).toBe(1);
    expect(scene.requestRender).toHaveBeenCalledTimes(2);

    provider.destroy();
  });
});
