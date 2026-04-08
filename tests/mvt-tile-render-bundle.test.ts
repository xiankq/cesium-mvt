import { WebMercatorTilingScheme } from '@cesium/engine';
import { describe, expect, it } from 'vitest';
import { parseMvtVectorTile } from '../src/mvt/parse/mvt-vector-tile-parser';
import { createMvtTileRenderBundle } from '../src/mvt/render/mvt-tile-render-bundle';
import { createTestMvtArrayBuffer } from './mvt-test-tile';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

describe('mvt-tile-render-bundle', () => {
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

    const parsedTile = parseMvtVectorTile(tileBuffer, styleSet, 14);
    const renderBundle = createMvtTileRenderBundle({
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
