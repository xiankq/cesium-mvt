import type { FeatureCollection, Point } from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSourceLayer,
  listSourceLayers,
  loadVectorTile,
  parseVectorTile,
} from '@/mvt/source/vector-tile';

function createTileBuffer() {
  const data: FeatureCollection<Point, { name: string }> = {
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
  };
  const tileIndex = new GeoJSONVT(data);
  const tile = tileIndex.getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  const encoded = fromGeojsonVt({ poi: tile } as Parameters<typeof fromGeojsonVt>[0]);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

describe('vector-tile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses source layers and features from a tile buffer', () => {
    const tile = parseVectorTile(createTileBuffer());
    const layer = getSourceLayer(tile, 'poi');

    expect(listSourceLayers(tile)).toEqual(['poi']);
    expect(layer?.length).toBe(1);
    expect(layer?.feature(0).properties).toEqual({
      name: 'poi-a',
    });
  });

  it('loads and decodes a vector tile from fetch', async () => {
    const tileBuffer = createTileBuffer();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      arrayBuffer: async () => tileBuffer,
      ok: true,
    })));

    const tile = await loadVectorTile({
      coordinate: {
        level: 3,
        x: 4,
        y: 5,
      },
      key: 'base/3/4/5',
      sourceId: 'base',
      url: 'https://tiles.example.com/3/4/5.pbf',
    }, new AbortController().signal);

    expect(listSourceLayers(tile)).toEqual(['poi']);
    expect(getSourceLayer(tile, 'poi')?.feature(0).properties).toEqual({
      name: 'poi-a',
    });
  });
});
