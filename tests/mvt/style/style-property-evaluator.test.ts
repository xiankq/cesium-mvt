import type { StylePropertyContext } from '@/mvt/style/style-property-evaluator';
import { describe, expect, it } from 'vitest';
import {
  createStylePropertyEvaluator,

} from '@/mvt/style/style-property-evaluator';

function createContext(overrides: Partial<StylePropertyContext> = {}): StylePropertyContext {
  return {
    geometryType: 'Point',
    properties: {},
    zoom: 0,
    ...overrides,
  };
}

describe('style-property-evaluator', () => {
  describe('静态值', () => {
    it('解析静态颜色值', () => {
      const evaluator = createStylePropertyEvaluator('#ff0000');
      const result = evaluator(createContext());
      expect(result).toBe('#ff0000');
    });

    it('解析静态数值', () => {
      const evaluator = createStylePropertyEvaluator(5);
      const result = evaluator(createContext());
      expect(result).toBe(5);
    });

    it('解析静态布尔值', () => {
      const evaluator = createStylePropertyEvaluator(true);
      const result = evaluator(createContext());
      expect(result).toBe(true);
    });
  });

  describe('表达式', () => {
    it('解析表达式', () => {
      const evaluator = createStylePropertyEvaluator(['get', 'name']);
      const result = evaluator(createContext({
        properties: { name: 'Beijing' },
      }));
      expect(result).toBe('Beijing');
    });

    it('解析条件表达式', () => {
      const evaluator = createStylePropertyEvaluator([
        'case',
        ['>=', ['get', 'population'], 1000000],
        'large',
        'small',
      ]);
      expect(evaluator(createContext({
        properties: { population: 2000000 },
      }))).toBe('large');
      expect(evaluator(createContext({
        properties: { population: 500000 },
      }))).toBe('small');
    });
  });

  describe('zoom 函数', () => {
    it('解析 zoom 函数（stops 格式）', () => {
      const evaluator = createStylePropertyEvaluator({
        stops: [
          [0, 1],
          [10, 5],
          [20, 10],
        ],
      });
      expect(evaluator(createContext({ zoom: 0 }))).toBe(1);
      expect(evaluator(createContext({ zoom: 5 }))).toBe(3);
      expect(evaluator(createContext({ zoom: 10 }))).toBe(5);
      expect(evaluator(createContext({ zoom: 15 }))).toBe(7.5);
      expect(evaluator(createContext({ zoom: 20 }))).toBe(10);
    });

    it('解析 zoom 函数（带 base）', () => {
      const evaluator = createStylePropertyEvaluator({
        base: 2,
        stops: [
          [0, 1],
          [10, 100],
        ],
      });
      // MapLibre 指数插值公式: (base^progress - 1) / (base^difference - 1)
      // progress = 5 - 0 = 5, difference = 10 - 0 = 10
      // factor = (2^5 - 1) / (2^10 - 1) = 31 / 1023 ≈ 0.0303
      // result = 1 + 0.0303 * 99 ≈ 4
      expect(evaluator(createContext({ zoom: 5 }))).toBeCloseTo(4, 0);
    });

    it('解析 zoom 函数（颜色）', () => {
      const evaluator = createStylePropertyEvaluator({
        stops: [
          [0, '#ff0000'],
          [10, '#0000ff'],
        ],
      });
      const result = evaluator(createContext({ zoom: 5 }));
      expect(result).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('数据驱动样式', () => {
    it('解析数据驱动样式（property 函数）', () => {
      const evaluator = createStylePropertyEvaluator({
        property: 'population',
        stops: [
          [0, 'small'],
          [100000, 'medium'],
          [1000000, 'large'],
        ],
      });
      expect(evaluator(createContext({
        properties: { population: 50000 },
      }))).toBe('small');
      expect(evaluator(createContext({
        properties: { population: 500000 },
      }))).toBe('medium');
      expect(evaluator(createContext({
        properties: { population: 5000000 },
      }))).toBe('large');
    });

    it('解析数据驱动样式（带 type）', () => {
      const evaluator = createStylePropertyEvaluator({
        property: 'type',
        type: 'categorical',
        stops: [
          ['city', 'urban'],
          ['village', 'rural'],
        ],
        default: 'unknown',
      });
      expect(evaluator(createContext({
        properties: { type: 'city' },
      }))).toBe('urban');
      expect(evaluator(createContext({
        properties: { type: 'village' },
      }))).toBe('rural');
      expect(evaluator(createContext({
        properties: { type: 'unknown' },
      }))).toBe('unknown');
    });
  });

  describe('组合 zoom 和数据驱动', () => {
    it('解析组合函数（zoom + property）', () => {
      const evaluator = createStylePropertyEvaluator({
        property: 'type',
        stops: [
          [
            { zoom: 0, value: 'city' },
            1,
          ],
          [
            { zoom: 0, value: 'village' },
            0.5,
          ],
          [
            { zoom: 10, value: 'city' },
            5,
          ],
          [
            { zoom: 10, value: 'village' },
            2,
          ],
        ],
      });

      expect(evaluator(createContext({
        properties: { type: 'city' },
        zoom: 0,
      }))).toBe(1);
      expect(evaluator(createContext({
        properties: { type: 'village' },
        zoom: 0,
      }))).toBe(0.5);
      expect(evaluator(createContext({
        properties: { type: 'city' },
        zoom: 10,
      }))).toBe(5);
    });
  });

  describe('默认值', () => {
    it('返回默认值当属性不存在时', () => {
      const evaluator = createStylePropertyEvaluator(['get', 'missing'], 'default');
      const result = evaluator(createContext());
      expect(result).toBe('default');
    });

    it('返回默认值当表达式返回 null 时', () => {
      const evaluator = createStylePropertyEvaluator(['get', 'missing'], 'default');
      const result = evaluator(createContext());
      expect(result).toBe('default');
    });
  });

  describe('缓存', () => {
    it('相同 zoom 级别应该缓存结果', () => {
      const evaluator = createStylePropertyEvaluator({
        stops: [
          [0, 1],
          [10, 5],
        ],
      });

      const context1 = createContext({ zoom: 5 });
      const context2 = createContext({ zoom: 5 });

      const result1 = evaluator(context1);
      const result2 = evaluator(context2);

      expect(result1).toBe(result2);
    });
  });
});
