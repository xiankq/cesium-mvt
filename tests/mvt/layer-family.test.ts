import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { createLayerFamilies } from '@/mvt/style/layer-family';

describe('layer-family', () => {
  it('groups consecutive compatible geometry layers into the same family', () => {
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
          'id': 'building',
          'type': 'fill-extrusion',
          'source': 'base',
          'source-layer': 'building',
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
        layerIds: ['road-base', 'road-casing'],
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'line',
      },
      {
        id: 'base/road/symbol/2',
        layerIds: ['label'],
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'symbol',
      },
      {
        id: 'base/road/line/3',
        layerIds: ['road-dash'],
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'line',
      },
      {
        id: 'base/building/fill-extrusion/4',
        layerIds: ['building'],
        sourceId: 'base',
        sourceLayer: 'building',
        type: 'fill-extrusion',
      },
      {
        id: 'base/poi/circle/5',
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

  it('应该在 filter 不同的时候拆分 family', () => {
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
          'id': 'land-a',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
          'filter': ['==', ['get', 'kind'], 'park'],
        },
        {
          'id': 'land-b',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
          'filter': ['==', ['get', 'kind'], 'grass'],
        },
      ],
    };

    expect(createLayerFamilies(style)).toEqual([
      {
        id: 'base/land/fill/0',
        layerIds: ['land-a'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        id: 'base/land/fill/1',
        layerIds: ['land-b'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
    ]);
  });

  it('应该在 data-driven paint 不同的时候拆分 family', () => {
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
          'id': 'land-a',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
          'paint': {
            'fill-color': ['get', 'color'],
          },
        },
        {
          'id': 'land-b',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
          'paint': {
            'fill-color': '#00ff00',
          },
        },
      ],
    };

    expect(createLayerFamilies(style)).toEqual([
      {
        id: 'base/land/fill/0',
        layerIds: ['land-a'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        id: 'base/land/fill/1',
        layerIds: ['land-b'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
    ]);
  });

  it('应该在 sprite 依赖不同的时候拆分 family', () => {
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
          'id': 'land-pattern',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
          'paint': {
            'fill-pattern': 'forest',
          },
        },
        {
          'id': 'land-solid',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
      ],
    };

    expect(createLayerFamilies(style)).toEqual([
      {
        id: 'base/land/fill/0',
        layerIds: ['land-pattern'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        id: 'base/land/fill/1',
        layerIds: ['land-solid'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
    ]);
  });
});
