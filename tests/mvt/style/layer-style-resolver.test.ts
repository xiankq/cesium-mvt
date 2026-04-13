import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LayerStyleContext } from '@/mvt/style/layer-style-resolver';
import { describe, expect, it } from 'vitest';
import {
  createCircleLayerStyleResolver,
  createFillLayerStyleResolver,
  createLineLayerStyleResolver,

} from '@/mvt/style/layer-style-resolver';

function createContext(overrides: Partial<LayerStyleContext> = {}): LayerStyleContext {
  return {
    geometryType: 'Point',
    properties: {},
    zoom: 0,
    ...overrides,
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
      const result = resolver(createContext({
        properties: { color: '#00ff00' },
      }));
      expect(result.color).toBe('#00ff00');
    });

    it('解析 zoom 函数 circle-radius', () => {
      const layer = {
        id: 'test',
        type: 'circle' as const,
        source: 'test',
        paint: {
          'circle-radius': {
            stops: [
              [0, 1],
              [10, 10],
            ],
          },
        },
      } as CircleLayerSpecification;
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
          'circle-color': {
            property: 'type',
            type: 'categorical',
            stops: [
              ['city', '#ff0000'],
              ['village', '#00ff00'],
            ],
            default: '#000000',
          },
        },
      };
      const resolver = createCircleLayerStyleResolver(layer);
      expect(resolver(createContext({
        properties: { type: 'city' },
      })).color).toBe('#ff0000');
      expect(resolver(createContext({
        properties: { type: 'village' },
      })).color).toBe('#00ff00');
      expect(resolver(createContext({
        properties: { type: 'unknown' },
      })).color).toBe('#000000');
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
      expect(resolver(createContext({
        properties: { type: 'road' },
      })).color).toBe('#ff0000');
      expect(resolver(createContext({
        properties: { type: 'river' },
      })).color).toBe('#000000');
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
});
