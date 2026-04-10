import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { createLayerFamilies } from '@/mvt/style/layer-family';

describe('layer-family', () => {
  it('groups compatible geometry layers into the same family', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
        },
        {
          'id': 'land',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'land-outline',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'road-base',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
          'layout': {
            'line-cap': 'round',
          },
        },
        {
          'id': 'road-casing',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
          'layout': {
            'line-cap': 'round',
          },
        },
        {
          'id': 'label',
          'type': 'symbol',
          'source': 'base',
          'source-layer': 'road',
        },
        {
          'id': 'road-dash',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
          'layout': {
            'line-cap': 'round',
          },
        },
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };

    expect(createLayerFamilies(style)).toEqual([
      {
        id: 'base/land/fill/0',
        layerIds: ['land', 'land-outline'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        id: 'base/road/line/1',
        layerIds: ['road-base', 'road-casing', 'road-dash'],
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'line',
      },
      {
        id: 'base/poi/circle/2',
        layerIds: ['poi'],
        sourceId: 'base',
        sourceLayer: 'poi',
        type: 'circle',
      },
    ]);
  });

  it('assigns a synthetic source layer for geojson sources', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'poi',
          type: 'circle',
          source: 'places',
        },
      ],
    };

    expect(createLayerFamilies(style)).toEqual([
      {
        id: 'places/_geojson/circle/0',
        layerIds: ['poi'],
        sourceId: 'places',
        sourceLayer: '_geojson',
        type: 'circle',
      },
    ]);
  });
});
