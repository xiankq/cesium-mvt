import { WebMercatorTilingScheme } from '@cesium/engine';
import { describe, expect, it } from 'vitest';
import { parseMvtVectorTile } from '../src/mvt/parse/mvt-vector-tile-parser';
import { createMvtFeatureIndex, pickMvtFeatureIndex } from '../src/mvt/pick/mvt-feature-index';
import { createTestLocalMvtArrayBuffer } from './mvt-test-tile';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

describe('mvt-feature-index', () => {
  it('builds feature entries and picks matching features in a tile', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const coordinate = { x: 13423, y: 6452, z: 14 };
    const tilingScheme = new WebMercatorTilingScheme();
    const tileBuffer = createTestLocalMvtArrayBuffer({
      building: {
        features: [{
          geometry: {
            coordinates: [[[1024, 1024], [1024, 3072], [3072, 3072], [3072, 1024], [1024, 1024]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Feature Index Building',
          },
        }],
      },
    });

    const parsedTile = parseMvtVectorTile(tileBuffer, styleSet, coordinate.z);
    const featureIndex = createMvtFeatureIndex({
      coordinate,
      parsedTileData: parsedTile,
      styleSet,
    });

    expect(featureIndex.entries.length).toBeGreaterThan(0);

    const pickedEntry = featureIndex.entries[0]!;
    const rectangle = tilingScheme.tileXYToRectangle(coordinate.x, coordinate.y, coordinate.z);
    const longitude = rectangle.west + (rectangle.east - rectangle.west)
      * ((pickedEntry.bounds.minU + pickedEntry.bounds.maxU) * 0.5);
    const latitude = rectangle.north + (rectangle.south - rectangle.north)
      * ((pickedEntry.bounds.minV + pickedEntry.bounds.maxV) * 0.5);
    const pickedFeatures = pickMvtFeatureIndex({
      coordinate,
      featureIndex,
      latitude,
      longitude,
      tileHeight: 256,
      tileWidth: 256,
      tilingScheme,
    });

    expect(pickedFeatures.length).toBeGreaterThan(0);
    expect(pickedFeatures[0]?.name).toBe('Feature Index Building');
  }, 15000);
});
