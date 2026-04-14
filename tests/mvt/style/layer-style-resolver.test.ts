import type {
  CircleLayerSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LayerStyleContext } from '@/mvt/style/layer-style-resolver';
import { describe, expect, it } from 'vitest';
import { Formatted, ResolvedImage } from '@/mvt/style/expression-adapter';
import {
  createCircleLayerStyleResolver,
  createFillExtrusionLayerStyleResolver,
  createFillLayerStyleResolver,
  createLineLayerStyleResolver,
  createSymbolLayerStyleResolver,
} from '@/mvt/style/layer-style-resolver';

function createContext(overrides: Partial<LayerStyleContext> = {}): LayerStyleContext {
  return {
    zoom: 0,
    ...overrides,
  };
}

function createFeatureContext(properties: Record<string, unknown>, zoom = 0): LayerStyleContext {
  return {
    feature: {
      type: 'Point',
      properties,
    },
    zoom,
  };
}

describe('layer-style-resolver', () => {
  describe('circle 图层', () => {
    it('解析静态 circle-color', () => {
      const layer: CircleLayerSpecification = {
        id: 'test',
        type: 'circle',
        source: 'test',
        paint: {
          'circle-color': '#ff0000',
        },
      };
      const resolver = createCircleLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.color).toBe('#ff0000');
    });

    it('解析静态 circle-radius', () => {
      const layer: CircleLayerSpecification = {
        id: 'test',
        type: 'circle',
        source: 'test',
        paint: {
          'circle-radius': 10,
        },
      };
      const resolver = createCircleLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.radius).toBe(10);
    });

    it('解析表达式 circle-color', () => {
      const layer: CircleLayerSpecification = {
        id: 'test',
        type: 'circle',
        source: 'test',
        paint: {
          'circle-color': ['get', 'color'],
        },
      };
      const resolver = createCircleLayerStyleResolver(layer);
      const result = resolver(createFeatureContext({ color: '#00ff00' }));
      expect(result.color).toBe('#00ff00');
    });

    it('解析 zoom 函数 circle-radius', () => {
      const layer: CircleLayerSpecification = {
        id: 'test',
        type: 'circle',
        source: 'test',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            1,
            10,
            10,
          ],
        },
      };
      const resolver = createCircleLayerStyleResolver(layer);
      expect(resolver(createContext({ zoom: 0 })).radius).toBe(1);
      expect(resolver(createContext({ zoom: 5 })).radius).toBe(5.5);
      expect(resolver(createContext({ zoom: 10 })).radius).toBe(10);
    });

    it('解析数据驱动 circle-color', () => {
      const layer: CircleLayerSpecification = {
        id: 'test',
        type: 'circle',
        source: 'test',
        paint: {
          'circle-color': [
            'match',
            ['get', 'type'],
            'city',
            '#ff0000',
            'village',
            '#00ff00',
            '#000000',
          ],
        },
      };
      const resolver = createCircleLayerStyleResolver(layer);
      expect(resolver(createFeatureContext({ type: 'city' })).color).toBe('#ff0000');
      expect(resolver(createFeatureContext({ type: 'village' })).color).toBe('#00ff00');
      expect(resolver(createFeatureContext({ type: 'unknown' })).color).toBe('#000000');
    });

    it('使用默认值', () => {
      const layer: CircleLayerSpecification = {
        id: 'test',
        type: 'circle',
        source: 'test',
      };
      const resolver = createCircleLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.color).toBe('#000000');
      expect(result.radius).toBe(5);
      expect(result.opacity).toBe(1);
    });
  });

  describe('line 图层', () => {
    it('解析静态 line-color', () => {
      const layer: LineLayerSpecification = {
        id: 'test',
        type: 'line',
        source: 'test',
        paint: {
          'line-color': '#0000ff',
        },
      };
      const resolver = createLineLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.color).toBe('#0000ff');
    });

    it('解析静态 line-width', () => {
      const layer: LineLayerSpecification = {
        id: 'test',
        type: 'line',
        source: 'test',
        paint: {
          'line-width': 3,
        },
      };
      const resolver = createLineLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.width).toBe(3);
    });

    it('解析静态 line-pattern', () => {
      const layer: LineLayerSpecification = {
        id: 'test',
        type: 'line',
        source: 'test',
        paint: {
          'line-pattern': 'stripe',
        },
      };
      const resolver = createLineLayerStyleResolver(layer);
      const result = resolver(createContext()) as { pattern?: string };
      expect(result.pattern).toBe('stripe');
    });

    it('解析表达式 line-color', () => {
      const layer: LineLayerSpecification = {
        id: 'test',
        type: 'line',
        source: 'test',
        paint: {
          'line-color': ['case', ['==', ['get', 'type'], 'road'], '#ff0000', '#000000'],
        },
      };
      const resolver = createLineLayerStyleResolver(layer);
      expect(resolver(createFeatureContext({ type: 'road' })).color).toBe('#ff0000');
      expect(resolver(createFeatureContext({ type: 'river' })).color).toBe('#000000');
    });

    it('使用默认值', () => {
      const layer: LineLayerSpecification = {
        id: 'test',
        type: 'line',
        source: 'test',
      };
      const resolver = createLineLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.color).toBe('#000000');
      expect(result.width).toBe(1);
      expect(result.opacity).toBe(1);
    });
  });

  describe('fill 图层', () => {
    it('解析静态 fill-color', () => {
      const layer: FillLayerSpecification = {
        id: 'test',
        type: 'fill',
        source: 'test',
        paint: {
          'fill-color': '#ffff00',
        },
      };
      const resolver = createFillLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.color).toBe('#ffff00');
    });

    it('解析静态 fill-outline-color', () => {
      const layer: FillLayerSpecification = {
        id: 'test',
        type: 'fill',
        source: 'test',
        paint: {
          'fill-outline-color': '#000000',
        },
      };
      const resolver = createFillLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.outlineColor).toBe('#000000');
    });

    it('解析静态 fill-pattern', () => {
      const layer: FillLayerSpecification = {
        id: 'test',
        type: 'fill',
        source: 'test',
        paint: {
          'fill-pattern': 'stripe',
        },
      };
      const resolver = createFillLayerStyleResolver(layer);
      const result = resolver(createContext()) as { pattern?: string };
      expect(result.pattern).toBe('stripe');
    });

    it('解析静态 fill-opacity', () => {
      const layer: FillLayerSpecification = {
        id: 'test',
        type: 'fill',
        source: 'test',
        paint: {
          'fill-opacity': 0.5,
        },
      };
      const resolver = createFillLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.opacity).toBe(0.5);
    });

    it('解析表达式 fill-color', () => {
      const layer: FillLayerSpecification = {
        id: 'test',
        type: 'fill',
        source: 'test',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['zoom'], 0, '#ff0000', 10, '#0000ff'],
        },
      };
      const resolver = createFillLayerStyleResolver(layer);
      const result = resolver(createContext({ zoom: 5 }));
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('使用默认值', () => {
      const layer: FillLayerSpecification = {
        id: 'test',
        type: 'fill',
        source: 'test',
      };
      const resolver = createFillLayerStyleResolver(layer);
      const result = resolver(createContext());
      expect(result.color).toBe('#000000');
      expect(result.opacity).toBe(1);
      expect(result.outlineColor).toBeUndefined();
    });
  });

  describe('fill-extrusion 图层', () => {
    it('解析静态 fill-extrusion-color 和 height/base', () => {
      const layer: FillExtrusionLayerSpecification = {
        id: 'test',
        type: 'fill-extrusion',
        source: 'test',
        paint: {
          'fill-extrusion-base': 12,
          'fill-extrusion-color': '#123456',
          'fill-extrusion-height': 48,
          'fill-extrusion-opacity': 0.6,
        },
      };

      const resolver = createFillExtrusionLayerStyleResolver(layer);
      const result = resolver(createContext());

      expect(result.color).toBe('#123456');
      expect(result.base).toBe(12);
      expect(result.height).toBe(48);
      expect(result.opacity).toBe(0.6);
    });

    it('使用默认值', () => {
      const layer: FillExtrusionLayerSpecification = {
        id: 'test',
        type: 'fill-extrusion',
        source: 'test',
      };

      const resolver = createFillExtrusionLayerStyleResolver(layer);
      const result = resolver(createContext());

      expect(result.color).toBe('#000000');
      expect(result.base).toBe(0);
      expect(result.height).toBe(0);
      expect(result.opacity).toBe(1);
    });
  });

  describe('symbol 图层', () => {
    it('保留 text-field、text-font 和 icon-image 的 MapLibre 类型', () => {
      const layer: SymbolLayerSpecification = {
        id: 'test',
        layout: {
          'icon-image': ['image', 'museum-icon'],
          'text-field': ['format', ['get', 'name']],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        },
        source: 'test',
        type: 'symbol',
      };

      const resolver = createSymbolLayerStyleResolver(layer);
      const result = resolver(createFeatureContext({ name: 'museum' }));

      expect(result.textField).toBeInstanceOf(Formatted);
      expect(result.textField?.toString()).toBe('museum');
      expect(result.textFont).toEqual(['Open Sans Regular', 'Arial Unicode MS Regular']);
      expect(result.iconImage).toBeInstanceOf(ResolvedImage);
      if (result.iconImage instanceof ResolvedImage) {
        expect(result.iconImage.name).toBe('museum-icon');
      }
    });

    it('解析 symbol-sort-key 和 symbol-z-order', () => {
      const layer: SymbolLayerSpecification = {
        id: 'test',
        layout: {
          'symbol-sort-key': ['get', 'priority'],
          'symbol-z-order': 'viewport-y',
          'text-field': ['get', 'name'],
        },
        source: 'test',
        type: 'symbol',
      };

      const resolver = createSymbolLayerStyleResolver(layer);
      const result = resolver(createFeatureContext({ name: 'museum', priority: 7 }));

      expect((result as { sortKey?: number }).sortKey).toBe(7);
      expect((result as { zOrder?: string }).zOrder).toBe('viewport-y');
    });

    it('解析 text-optional 和 icon-optional', () => {
      const layer: SymbolLayerSpecification = {
        id: 'test',
        layout: {
          'icon-image': 'museum-icon',
          'icon-optional': true,
          'text-field': ['get', 'name'],
          'text-optional': true,
        },
        source: 'test',
        type: 'symbol',
      };

      const resolver = createSymbolLayerStyleResolver(layer);
      const result = resolver(createFeatureContext({ name: 'museum' }));

      expect((result as { textOptional?: boolean }).textOptional).toBe(true);
      expect((result as { iconOptional?: boolean }).iconOptional).toBe(true);
    });

    it('解析 symbol-placement 和碰撞相关语义', () => {
      const layer: SymbolLayerSpecification = {
        id: 'test',
        layout: {
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-image': 'museum-icon',
          'icon-keep-upright': true,
          'icon-overlap': 'always',
          'icon-pitch-alignment': 'map',
          'icon-rotation-alignment': 'viewport',
          'symbol-avoid-edges': true,
          'symbol-placement': 'line-center',
          'symbol-spacing': 320,
          'text-allow-overlap': true,
          'text-field': ['get', 'name'],
          'text-ignore-placement': true,
          'text-keep-upright': false,
          'text-overlap': 'cooperative',
          'text-pitch-alignment': 'viewport',
          'text-rotation-alignment': 'map',
        },
        paint: {
          'text-halo-blur': 1,
          'text-halo-color': '#abcdef',
          'text-halo-width': 2,
          'icon-translate-anchor': 'viewport',
          'icon-translate': [8, -6],
          'text-translate-anchor': 'viewport',
          'text-translate': [6, 4],
        },
        source: 'test',
        type: 'symbol',
      };

      const resolver = createSymbolLayerStyleResolver(layer);
      const result = resolver(createFeatureContext({ name: 'museum' }));

      expect(result.symbolPlacement).toBe('line-center');
      expect((result as { symbolSpacing?: number }).symbolSpacing).toBe(320);
      expect(result.symbolAvoidEdges).toBe(true);
      expect(result.textAllowOverlap).toBe(true);
      expect(result.textOverlap).toBe('cooperative');
      expect(result.textIgnorePlacement).toBe(true);
      expect(result.textHaloColor).toBe('#abcdef');
      expect(result.textHaloWidth).toBe(2);
      expect(result.textHaloBlur).toBe(1);
      expect(result.textTranslateAnchor).toBe('viewport');
      expect(result.textTranslate).toEqual([6, 4]);
      expect(result.textRotationAlignment).toBe('map');
      expect(result.textPitchAlignment).toBe('viewport');
      expect(result.textKeepUpright).toBe(false);
      expect(result.iconAllowOverlap).toBe(true);
      expect(result.iconOverlap).toBe('always');
      expect(result.iconIgnorePlacement).toBe(true);
      expect(result.iconTranslateAnchor).toBe('viewport');
      expect(result.iconTranslate).toEqual([8, -6]);
      expect(result.iconRotationAlignment).toBe('viewport');
      expect(result.iconPitchAlignment).toBe('map');
      expect(result.iconKeepUpright).toBe(true);
    });

    it('解析更多 symbol 布局语义', () => {
      const layer: SymbolLayerSpecification = {
        id: 'test',
        layout: {
          'icon-image': 'museum-icon',
          'icon-padding': 6,
          'icon-rotate': 20,
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1, 2, 3, 4],
          'symbol-placement': 'point',
          'text-field': ['get', 'name'],
          'text-justify': 'auto',
          'text-letter-spacing': 0.2,
          'text-line-height': 1.4,
          'text-max-angle': 30,
          'text-max-width': 12,
          'text-padding': 5,
          'text-radial-offset': 0.75,
          'text-rotate': 15,
          'text-transform': 'uppercase',
          'text-variable-anchor': ['top', 'left'],
          'text-variable-anchor-offset': ['top', [0, 4], 'left', [3, 0]],
          'text-writing-mode': ['horizontal'],
        },
        source: 'test',
        type: 'symbol',
      };

      const resolver = createSymbolLayerStyleResolver(layer);
      const result = resolver(createFeatureContext({ name: 'museum' }));

      expect(result.symbolPlacement).toBe('point');
      expect(result.textJustify).toBe('auto');
      expect(result.textLetterSpacing).toBe(0.2);
      expect(result.textLineHeight).toBe(1.4);
      expect(result.textMaxAngle).toBe(30);
      expect(result.textMaxWidth).toBe(12);
      expect(result.textPadding).toBe(5);
      expect(result.textRadialOffset).toBe(0.75);
      expect(result.textRotate).toBe(15);
      expect(result.textTransform).toBe('uppercase');
      expect(result.textVariableAnchor).toEqual(['top', 'left']);
      expect(result.textVariableAnchorOffset).toEqual(['top', [0, 4], 'left', [3, 0]]);
      expect(result.textWritingMode).toEqual(['horizontal']);
      expect(result.iconPadding).toBe(6);
      expect(result.iconRotate).toBe(20);
      expect(result.iconTextFit).toBe('both');
      expect(result.iconTextFitPadding).toEqual([1, 2, 3, 4]);
    });
  });
});
