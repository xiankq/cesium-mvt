import { describe, expect, it } from 'vitest';
import { collectVisibleProviderTileCoordinates } from '../src/mvt/mvt-visible-tile';

describe('mvt-visible-tile', () => {
  it('collects unique ready and loading imagery tiles for the current provider', () => {
    const provider = {};
    const otherProvider = {};

    const result = collectVisibleProviderTileCoordinates({
      globe: {
        _surface: {
          tileProvider: {
            _tilesToRenderByTextureCount: [[{
              data: {
                imagery: [
                  {
                    loadingImagery: {
                      imageryLayer: { imageryProvider: provider },
                      level: 5,
                      state: 1,
                      x: 4,
                      y: 6,
                    },
                    readyImagery: {
                      imageryLayer: { imageryProvider: provider },
                      level: 4,
                      state: 4,
                      x: 2,
                      y: 3,
                    },
                  },
                  {
                    readyImagery: {
                      imageryLayer: { imageryProvider: provider },
                      level: 4,
                      state: 4,
                      x: 2,
                      y: 3,
                    },
                  },
                  {
                    readyImagery: {
                      imageryLayer: { imageryProvider: otherProvider },
                      level: 8,
                      state: 4,
                      x: 9,
                      y: 10,
                    },
                  },
                  {
                    readyImagery: {
                      imageryLayer: { imageryProvider: provider },
                      level: 0,
                      state: 7,
                      x: 0,
                      y: 0,
                    },
                  },
                ],
              },
            }]],
          },
        },
      },
    } as any, provider);

    expect(result.available).toBe(true);
    expect(result.coordinates).toEqual([
      { x: 4, y: 6, z: 5 },
      { x: 2, y: 3, z: 4 },
    ]);
  });

  it('returns unavailable when Cesium private globe tile state is not ready', () => {
    const result = collectVisibleProviderTileCoordinates({} as any, {});

    expect(result).toEqual({
      available: false,
      coordinates: [],
    });
  });
});
