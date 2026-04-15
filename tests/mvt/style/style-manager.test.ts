import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { StyleManager } from '@/mvt/style/style-manager';

describe('style-manager', () => {
  it('应该为 style update 生成可复用的 style index', () => {
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
          'id': 'road',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
        },
      ],
    };

    const styleManager = new StyleManager();
    styleManager.updateStyle({ style });

    const styleIndex = styleManager.getStyleIndex();

    expect(styleIndex).toBeDefined();
    expect(styleIndex?.layerFamilies).toHaveLength(2);
    expect(styleIndex?.layersById.get('land')).toBe(style.layers[1]);
    expect(styleIndex?.familiesById.get('base/land/fill/0')?.layerIds).toEqual(['land']);
    expect(styleIndex?.layerOrderById.get('road')).toBe(2);
    expect(styleIndex?.renderOrder.map(entry => entry.layerId)).toEqual(['land', 'road']);
  });
});
