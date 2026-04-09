import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { createRenderOrder } from '../../src/mvt/render/render-order';
import {
  compileRenderTile,
  createRenderTileKey,
} from '../../src/mvt/render/render-tile';
import { createLayerFamilies } from '../../src/mvt/style/layer-family';

describe('render-tile', () => {
  it('compiles background and geometry batches from style order', () => {
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

    expect(compileRenderTile({
      key: createRenderTileKey('base', 3, 4, 5),
      layerFamilies,
      renderOrder,
      style,
      styleEpoch: 2,
    })).toEqual({
      background: {
        color: '#102030',
        layerId: 'background',
        order: 0,
      },
      epoch: 2,
      geometryBatches: [
        {
          backend: 'fill',
          familyId: 'base/land/fill/0',
          layerIds: ['land'],
          order: 1,
          sourceId: 'base',
          sourceLayer: 'land',
          type: 'fill',
        },
        {
          backend: 'line',
          familyId: 'base/road/line/1',
          layerIds: ['road'],
          order: 2,
          sourceId: 'base',
          sourceLayer: 'road',
          type: 'line',
        },
        {
          backend: 'circle',
          familyId: 'base/poi/circle/2',
          layerIds: ['poi'],
          order: 3,
          sourceId: 'base',
          sourceLayer: 'poi',
          type: 'circle',
        },
      ],
      key: 'base/3/4/5@2',
    });
  });

  it('emits one geometry batch per family for the requested source', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
        labels: {
          type: 'vector',
          tiles: ['https://tiles.example.com/labels/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'land-base',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'land-overlay',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'label-halo',
          'type': 'circle',
          'source': 'labels',
          'source-layer': 'poi',
        },
      ],
    };
    const layerFamilies = createLayerFamilies(style);
    const renderOrder = createRenderOrder(style, layerFamilies);

    expect(compileRenderTile({
      key: createRenderTileKey('base', 6, 10, 12),
      layerFamilies,
      renderOrder,
      style,
      styleEpoch: 3,
    })).toMatchObject({
      epoch: 3,
      geometryBatches: [
        {
          backend: 'fill',
          familyId: 'base/land/fill/0',
          layerIds: ['land-base', 'land-overlay'],
          order: 0,
          sourceId: 'base',
        },
      ],
      key: 'base/6/10/12@3',
    });
  });

  it('filters geometry layers by tile zoom and layout visibility before batching', () => {
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
          'id': 'land-low',
          'maxzoom': 5,
          'source': 'base',
          'source-layer': 'land',
          'type': 'fill',
        },
        {
          'id': 'land-high',
          'minzoom': 5,
          'source': 'base',
          'source-layer': 'land',
          'type': 'fill',
        },
        {
          'id': 'road-hidden',
          'layout': {
            visibility: 'none',
          },
          'source': 'base',
          'source-layer': 'road',
          'type': 'line',
        },
      ],
    };
    const layerFamilies = createLayerFamilies(style);
    const renderOrder = createRenderOrder(style, layerFamilies);

    expect(compileRenderTile({
      key: createRenderTileKey('base', 4, 1, 2),
      layerFamilies,
      renderOrder,
      style,
      styleEpoch: 1,
    })).toMatchObject({
      geometryBatches: [
        {
          familyId: 'base/land/fill/0',
          layerIds: ['land-low'],
          order: 0,
        },
      ],
    });

    expect(compileRenderTile({
      key: createRenderTileKey('base', 5, 1, 2),
      layerFamilies,
      renderOrder,
      style,
      styleEpoch: 1,
    })).toMatchObject({
      geometryBatches: [
        {
          familyId: 'base/land/fill/0',
          layerIds: ['land-high'],
          order: 1,
        },
      ],
    });
  });
});
