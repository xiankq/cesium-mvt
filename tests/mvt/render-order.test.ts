import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { createRenderOrder } from '@/mvt/render/render-order';
import { createLayerFamilies } from '@/mvt/style/layer-family';

describe('render-order', () => {
  it('keeps supported layers in style order and attaches family ids', () => {
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
          'id': 'label',
          'type': 'symbol',
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

    expect(createRenderOrder(style, layerFamilies)).toEqual([
      {
        kind: 'background',
        layerId: 'background',
        order: 0,
        type: 'background',
      },
      {
        familyId: 'base/land/fill/0',
        kind: 'geometry',
        layerId: 'land',
        order: 1,
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        familyId: 'base/land/symbol/1',
        kind: 'geometry',
        layerId: 'label',
        order: 2,
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'symbol',
      },
      {
        familyId: 'base/road/line/2',
        kind: 'geometry',
        layerId: 'road',
        order: 3,
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'line',
      },
      {
        familyId: 'base/poi/circle/3',
        kind: 'geometry',
        layerId: 'poi',
        order: 4,
        sourceId: 'base',
        sourceLayer: 'poi',
        type: 'circle',
      },
    ]);
  });
});
