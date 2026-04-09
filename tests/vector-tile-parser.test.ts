import { describe, expect, it } from 'vitest';
import { parseVectorTile } from '../src/mvt/parse/vector-tile-parser';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';
import { createTestMvtArrayBuffer } from './test-tile';

describe('vector-tile-parser', () => {
  it('parses vector tile data into style-matched fill and line buckets', async () => {
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
              name: 'Test Building',
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
    const buildingBucket = parsedTile.buckets.find(bucket => bucket.sourceLayer === 'building');
    const waterwayBucket = parsedTile.buckets.find((bucket) => {
      return bucket.sourceLayer === 'waterway'
        && bucket.layerIds.includes('waterway-river');
    });

    expect(parsedTile.bucketCount).toBeGreaterThan(0);
    expect(parsedTile.byteLength).toBeGreaterThan(0);
    expect(buildingBucket?.type).toBe('fill');
    expect(buildingBucket?.featureCount).toBe(1);
    expect(buildingBucket?.features[0]?.geometryType).toBe('Polygon');
    expect(waterwayBucket?.type).toBe('line');
    expect(waterwayBucket?.featureCount).toBe(1);
    expect(waterwayBucket?.features[0]?.geometryType).toBe('LineString');
  });
});
