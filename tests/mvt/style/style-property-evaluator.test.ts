import type { StylePropertyContext } from '@/mvt/style/style-property-evaluator';
import { describe, expect, it } from 'vitest';
import {
  createColorPropertyEvaluator,
  createNumberArrayPropertyEvaluator,
  createNumberPropertyEvaluator,
  createStylePropertyEvaluator,
} from '@/mvt/style/style-property-evaluator';

function createContext(overrides: Partial<StylePropertyContext> = {}): StylePropertyContext {
  return {
    zoom: 0,
    ...overrides,
  };
}

function createFeatureContext(properties: Record<string, unknown>, zoom = 0): StylePropertyContext {
  return {
    feature: {
      type: 'Point',
      properties,
    },
    zoom,
  };
}

describe('style-property-evaluator', () => {
  describe('静态值', () => {
    it('解析静态颜色值', () => {
      const evaluator = createColorPropertyEvaluator('#ff0000');
      const result = evaluator(createContext());
      expect(result).toBe('#ff0000');
    });

    it('解析静态数值', () => {
      const evaluator = createNumberPropertyEvaluator(5);
      const result = evaluator(createContext());
      expect(result).toBe(5);
    });

    it('允许 translate 类数组包含负数', () => {
      const evaluator = createNumberArrayPropertyEvaluator([8, -6], undefined, { allowNegative: true });
      const result = evaluator(createContext());

      expect(result).toEqual([8, -6]);
    });
  });

  describe('表达式', () => {
    it('解析表达式', () => {
      const evaluator = createStylePropertyEvaluator(['get', 'name'], '', {
        'type': 'string',
        'property-type': 'data-driven',
        'transition': false,
        'default': '',
      });
      const result = evaluator(createFeatureContext({ name: 'Beijing' }));
      expect(result).toBe('Beijing');
    });

    it('解析条件表达式', () => {
      const evaluator = createStylePropertyEvaluator([
        'case',
        ['>=', ['get', 'population'], 1000000],
        'large',
        'small',
      ], '', {
        'type': 'string',
        'property-type': 'data-driven',
        'transition': false,
        'default': '',
      });
      expect(evaluator(createFeatureContext({ population: 2000000 }))).toBe('large');
      expect(evaluator(createFeatureContext({ population: 500000 }))).toBe('small');
    });
  });

  describe('zoom 表达式', () => {
    it('解析 interpolate zoom 表达式', () => {
      const evaluator = createNumberPropertyEvaluator([
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1,
        10,
        5,
        20,
        10,
      ]);
      expect(evaluator(createContext({ zoom: 0 }))).toBe(1);
      expect(evaluator(createContext({ zoom: 5 }))).toBe(3);
      expect(evaluator(createContext({ zoom: 10 }))).toBe(5);
      expect(evaluator(createContext({ zoom: 15 }))).toBe(7.5);
      expect(evaluator(createContext({ zoom: 20 }))).toBe(10);
    });

    it('解析 interpolate zoom 表达式（带 base）', () => {
      const evaluator = createNumberPropertyEvaluator([
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        0,
        1,
        10,
        100,
      ]);
      expect(evaluator(createContext({ zoom: 5 }))).toBeCloseTo(4, 0);
    });

    it('解析 interpolate zoom 表达式（颜色）', () => {
      const evaluator = createColorPropertyEvaluator([
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        '#ff0000',
        10,
        '#0000ff',
      ]);
      const result = evaluator(createContext({ zoom: 5 }));
      expect(result).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('数据驱动样式', () => {
    it('解析数据驱动样式（step 表达式）', () => {
      const evaluator = createStylePropertyEvaluator([
        'step',
        ['get', 'population'],
        'small',
        100000,
        'medium',
        1000000,
        'large',
      ], '', {
        'type': 'string',
        'property-type': 'data-driven',
        'transition': false,
        'default': '',
      });
      expect(evaluator(createFeatureContext({ population: 50000 }))).toBe('small');
      expect(evaluator(createFeatureContext({ population: 500000 }))).toBe('medium');
      expect(evaluator(createFeatureContext({ population: 5000000 }))).toBe('large');
    });

    it('解析数据驱动样式（match 表达式）', () => {
      const evaluator = createStylePropertyEvaluator([
        'match',
        ['get', 'type'],
        'city',
        'urban',
        'village',
        'rural',
        'unknown',
      ], '', {
        'type': 'string',
        'property-type': 'data-driven',
        'transition': false,
        'default': '',
      });
      expect(evaluator(createFeatureContext({ type: 'city' }))).toBe('urban');
      expect(evaluator(createFeatureContext({ type: 'village' }))).toBe('rural');
      expect(evaluator(createFeatureContext({ type: 'unknown' }))).toBe('unknown');
    });
  });

  describe('组合 zoom 和数据驱动', () => {
    it('解析组合表达式（zoom + feature）', () => {
      const evaluator = createNumberPropertyEvaluator([
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        ['case', ['==', ['get', 'type'], 'city'], 1, 0.5],
        10,
        ['case', ['==', ['get', 'type'], 'city'], 5, 2],
      ]);

      expect(evaluator(createFeatureContext({ type: 'city' }, 0))).toBe(1);
      expect(evaluator(createFeatureContext({ type: 'village' }, 0))).toBe(0.5);
      expect(evaluator(createFeatureContext({ type: 'city' }, 10))).toBe(5);
    });
  });

  describe('默认值', () => {
    it('返回默认值当属性不存在时', () => {
      const evaluator = createStylePropertyEvaluator(
        ['coalesce', ['get', 'missing'], 'default'],
        '',
        {
          'type': 'string',
          'property-type': 'data-driven',
          'transition': false,
          'default': '',
        },
      );
      const result = evaluator(createFeatureContext({}));
      expect(result).toBe('default');
    });
  });
});
