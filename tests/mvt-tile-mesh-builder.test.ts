import { describe, expect, it } from 'vitest';
import { buildMvtTileMesh } from '../src/mvt/mesh/mvt-tile-mesh-builder';
import { parseMvtVectorTile } from '../src/mvt/parse/mvt-vector-tile-parser';
import { createTestLocalMvtArrayBuffer } from './mvt-test-tile';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

describe('mvt-tile-mesh-builder', () => {
  it('builds Cesium-friendly fill and line mesh arrays from parsed tile data', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestLocalMvtArrayBuffer({
      building: {
        features: [{
          geometry: {
            coordinates: [[[256, 256], [256, 1536], [1536, 1536], [1536, 256], [256, 256]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Mesh Test Building',
          },
        }],
      },
      waterway: {
        features: [{
          geometry: {
            coordinates: [[512, 512], [2048, 1536], [3584, 2560]],
            type: 'LineString',
          },
          properties: {
            brunnel: 'none',
            class: 'river',
            intermittent: 0,
          },
        }],
      },
    });

    const parsedTile = parseMvtVectorTile(tileBuffer, styleSet, 14);
    const tileMesh = buildMvtTileMesh(parsedTile);
    const fillBucket = tileMesh.buckets.find(bucket => bucket.type === 'fill');
    const lineBucket = tileMesh.buckets.find(bucket => bucket.type === 'line');

    expect(tileMesh.bucketCount).toBeGreaterThan(0);
    expect(tileMesh.byteLength).toBeGreaterThan(0);
    expect(fillBucket?.vertexCount).toBeGreaterThan(0);
    expect(fillBucket?.indexCount).toBeGreaterThan(0);
    expect(fillBucket?.bounds.width).toBeGreaterThan(0);
    expect(lineBucket?.vertexCount).toBeGreaterThan(0);
    expect(lineBucket?.indexCount).toBeGreaterThan(0);
    expect(lineBucket?.type).toBe('line');
    if (lineBucket?.type === 'line') {
      expect(lineBucket.extrudes.length).toBe(lineBucket.positions.length);
    }
  }, 15000);
});
