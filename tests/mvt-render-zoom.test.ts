import type { MvtStyleSpecification } from '../src/mvt/mvt-types';
import { WebMercatorTilingScheme } from '@cesium/engine';
import { describe, expect, it } from 'vitest';
import { parseMvtVectorTile } from '../src/mvt/parse/mvt-vector-tile-parser';
import { createMvtTileRenderBundle } from '../src/mvt/render/mvt-tile-render-bundle';
import { MvtStyleSet } from '../src/mvt/style/mvt-style-set';
import { createTestMvtArrayBuffer } from './mvt-test-tile';

function createZoomBoundStyleSet(): MvtStyleSet {
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

  return MvtStyleSet.fromSpecification(specification, { source: 'test' });
}

describe('mvt-render-zoom', () => {
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

    const parsedTile = parseMvtVectorTile(tileBuffer, styleSet, 8);
    expect(parsedTile.buckets).toHaveLength(1);

    const renderBundle = createMvtTileRenderBundle({
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
