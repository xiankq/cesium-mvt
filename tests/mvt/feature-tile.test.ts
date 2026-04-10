import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { describe, expect, it } from 'vitest';
import { compileFeatureTile } from '@/mvt/render/feature-tile';
import { createRenderOrder } from '@/mvt/render/render-order';
import { compileRenderTile, createRenderTileKey } from '@/mvt/render/render-tile';
import { parseVectorTile } from '@/mvt/source/vector-tile';
import { createLayerFamilies } from '@/mvt/style/layer-family';

function createComplexTileBuffer() {
  const land: FeatureCollection<Polygon, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        },
        properties: {
          kind: 'park',
        },
      },
    ],
  };
  const road: FeatureCollection<LineString | Point, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[0, 0], [1, 1]],
        },
        properties: {
          kind: 'main',
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0.5, 0.5],
        },
        properties: {
          kind: 'ignore-me',
        },
      },
    ],
  };
  const poi: FeatureCollection<Point, { name: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0.25, 0.25],
        },
        properties: {
          name: 'cafe',
        },
      },
    ],
  };
  const encoded = fromGeojsonVt({
    land: getTileForFixture(land),
    poi: getTileForFixture(poi),
    road: getTileForFixture(road),
  });

  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  );
}

function getTileForFixture(data: FeatureCollection) {
  const tile = new GeoJSONVT(data).getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  return tile;
}

describe('feature-tile', () => {
  it('extracts render batches with backend-matching feature geometry', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': '#102030',
          },
        },
        {
          'id': 'land',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'road',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
        },
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };
    const layerFamilies = createLayerFamilies(style);
    const renderOrder = createRenderOrder(style, layerFamilies);
    const renderTile = compileRenderTile({
      key: createRenderTileKey('base', 0, 0, 0),
      layerFamilies,
      renderOrder,
      style,
      styleEpoch: 1,
    });
    const featureTile = compileFeatureTile({
      renderTile,
      tile: parseVectorTile(createComplexTileBuffer()),
    });

    expect(featureTile).toMatchObject({
      background: {
        color: '#102030',
        layerId: 'background',
      },
      epoch: 1,
      geometryBatches: [
        {
          extent: 4096,
          familyId: 'base/land/fill/0',
          featureCount: 1,
          type: 'fill',
        },
        {
          extent: 4096,
          familyId: 'base/road/line/1',
          featureCount: 1,
          type: 'line',
        },
        {
          extent: 4096,
          familyId: 'base/poi/circle/2',
          featureCount: 1,
          type: 'circle',
        },
      ],
      key: 'base/0/0/0@1',
    });
    expect(featureTile.geometryBatches[0]?.features[0]).toMatchObject({
      properties: {
        kind: 'park',
      },
      type: 'polygon',
    });
    expect(featureTile.geometryBatches[1]?.features[0]).toMatchObject({
      properties: {
        kind: 'main',
      },
      type: 'line',
    });
    expect(featureTile.geometryBatches[2]?.features[0]).toMatchObject({
      properties: {
        name: 'cafe',
      },
      type: 'point',
    });
  });

  it('skips geometry batches when the source layer is missing from the tile', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'land',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'building',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'building',
        },
      ],
    };
    const layerFamilies = createLayerFamilies(style);
    const renderTile = compileRenderTile({
      key: createRenderTileKey('base', 0, 0, 0),
      layerFamilies,
      renderOrder: createRenderOrder(style, layerFamilies),
      style,
      styleEpoch: 1,
    });

    const featureTile = compileFeatureTile({
      renderTile,
      tile: parseVectorTile(createComplexTileBuffer()),
    });

    expect(featureTile.geometryBatches).toHaveLength(1);
    expect(featureTile.geometryBatches[0]?.familyId).toBe('base/land/fill/0');
  });
});
