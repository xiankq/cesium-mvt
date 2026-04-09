import { WebMercatorTilingScheme } from '@cesium/engine';
import { describe, expect, it } from 'vitest';
import { parseVectorTile } from '../src/mvt/parse/vector-tile-parser';
import { createTileRenderBundle } from '../src/mvt/render/tile-render-bundle';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';
import { createTestMvtArrayBuffer } from './test-tile';

describe('tile-render-bundle', () => {
  it('builds Cesium buffer collections from parsed openfreemap tile data', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[0, 0], [0, 8], [8, 8], [8, 0], [0, 0]]],
              type: 'Polygon',
            },
            properties: {
              name: 'Render Bundle Building',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
      waterway: {
        features: [
          {
            geometry: {
              coordinates: [[-10, 0], [0, 10], [10, 18]],
              type: 'LineString',
            },
            properties: {
              brunnel: 'none',
              class: 'river',
              intermittent: 0,
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    const parsedTile = parseVectorTile(tileBuffer, styleSet, 14);
    const renderBundle = createTileRenderBundle({
      coordinate: { x: 13423, y: 6452, z: 14 },
      parsedTileData: parsedTile,
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    expect(renderBundle.byteLength).toBeGreaterThan(0);
    expect(renderBundle.isDestroyed()).toBe(false);
    expect(() => renderBundle.update({ frameNumber: 1 })).not.toThrow();

    renderBundle.destroy();
    expect(renderBundle.isDestroyed()).toBe(true);
  });
});
