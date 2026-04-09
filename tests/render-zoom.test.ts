import type { MvtStyleSpecification } from '../src/mvt/types';
import { WebMercatorTilingScheme } from '@cesium/engine';
import { describe, expect, it } from 'vitest';
import { parseVectorTile } from '../src/mvt/parse/vector-tile-parser';
import { createTileRenderBundle } from '../src/mvt/render/tile-render-bundle';
import { StyleSet } from '../src/mvt/style/style-set';
import { createTestMvtArrayBuffer } from './test-tile';

function createZoomBoundStyleSet(): StyleSet {
  const specification: MvtStyleSpecification = {
    glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        'id': 'late-building',
        'maxzoom': 12,
        'minzoom': 10,
        'paint': {
          'fill-color': '#d95f02',
        },
        'source': 'test',
        'source-layer': 'building',
        'type': 'fill',
      },
    ],
    sources: {
      test: {
        tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        type: 'vector',
      },
    },
    version: 8,
  };

  return StyleSet.fromSpecification(specification, { source: 'test' });
}

describe('render-zoom', () => {
  it('keeps buckets during parse and rebuilds renderables at the current render zoom', () => {
    const styleSet = createZoomBoundStyleSet();
    const tileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[0, 0], [0, 8], [8, 8], [8, 0], [0, 0]]],
              type: 'Polygon',
            },
            properties: {},
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    const parsedTile = parseVectorTile(tileBuffer, styleSet, 8);
    expect(parsedTile.buckets).toHaveLength(1);

    const renderBundle = createTileRenderBundle({
      coordinate: { x: 106, y: 51, z: 8 },
      parsedTileData: parsedTile,
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    expect(renderBundle.byteLength).toBe(0);

    renderBundle.update({}, 10);
    expect(renderBundle.byteLength).toBeGreaterThan(0);

    renderBundle.update({}, 12);
    expect(renderBundle.byteLength).toBe(0);

    renderBundle.destroy();
  });
});
