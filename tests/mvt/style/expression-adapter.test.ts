import { describe, expect, it } from 'vitest';
import {
  Color,
  createExpression,
  evaluateExpression,
  evaluateFilter,
  featureFilter,
  isExpression,
  NullType,
} from '@/mvt/style/expression-adapter';

describe('expression-adapter', () => {
  describe('类型导出', () => {
    it('导出 NullType', () => {
      expect(NullType.kind).toBe('null');
    });
  });

  describe('isExpression', () => {
    it('字面量不是表达式', () => {
      expect(isExpression(42)).toBe(false);
      expect(isExpression('hello')).toBe(false);
      expect(isExpression(null)).toBe(false);
    });

    it('表达式数组是表达式', () => {
      expect(isExpression(['get', 'name'])).toBe(true);
      expect(isExpression(['+', 1, 2])).toBe(true);
    });

    it('空数组不是表达式', () => {
      expect(isExpression([])).toBe(false);
    });

    it('纯数组不是表达式', () => {
      expect(isExpression([1, 2, 3])).toBe(false);
    });
  });

  describe('createExpression', () => {
    it('创建字面量表达式', () => {
      const result = createExpression(42);
      expect(result.result).toBe('success');
      if (result.result === 'success') {
        expect(result.value.evaluate({ zoom: 0 })).toBe(42);
      }
    });

    it('创建属性访问表达式', () => {
      const result = createExpression(['get', 'name']);
      expect(result.result).toBe('success');
      if (result.result === 'success') {
        const value = result.value.evaluate(
          { zoom: 0 },
          { type: 'Point', properties: { name: 'test' } },
        );
        expect(value).toBe('test');
      }
    });

    it('创建数学表达式', () => {
      const result = createExpression(['+', 1, 2]);
      expect(result.result).toBe('success');
      if (result.result === 'success') {
        expect(result.value.evaluate({ zoom: 0 })).toBe(3);
      }
    });

    it('创建条件表达式', () => {
      const result = createExpression([
        'case',
        ['>', ['get', 'value'], 10],
        'high',
        'low',
      ]);
      expect(result.result).toBe('success');
      if (result.result === 'success') {
        expect(
          result.value.evaluate({ zoom: 0 }, { type: 'Point', properties: { value: 15 } }),
        ).toBe('high');
        expect(
          result.value.evaluate({ zoom: 0 }, { type: 'Point', properties: { value: 5 } }),
        ).toBe('low');
      }
    });

    it('无效表达式返回错误', () => {
      const result = createExpression(['unknown-operator']);
      expect(result.result).toBe('error');
    });
  });

  describe('evaluateExpression', () => {
    it('求值表达式', () => {
      const result = createExpression(['get', 'name']);
      expect(result.result).toBe('success');
      if (result.result === 'success') {
        const value = evaluateExpression(result.value, {
          zoom: 10,
          feature: { type: 'Point', properties: { name: 'test' } },
        });
        expect(value).toBe('test');
      }
    });
  });

  describe('featureFilter', () => {
    it('创建过滤器', () => {
      const filter = featureFilter(['==', ['get', 'type'], 'road']);
      expect(filter).toBeDefined();
      expect(filter.needGeometry).toBeDefined();
    });

    it('过滤器求值', () => {
      const filter = featureFilter(['==', ['get', 'type'], 'road']);
      const result = evaluateFilter(filter, {
        zoom: 10,
        feature: { type: 'Point', properties: { type: 'road' } },
      });
      expect(result).toBe(true);
    });

    it('过滤器排除', () => {
      const filter = featureFilter(['==', ['get', 'type'], 'road']);
      const result = evaluateFilter(filter, {
        zoom: 10,
        feature: { type: 'Point', properties: { type: 'building' } },
      });
      expect(result).toBe(false);
    });
  });

  describe('color', () => {
    it('解析颜色', () => {
      const color = Color.parse('#ff0000');
      expect(color).toBeDefined();
      if (color) {
        expect(color.r).toBe(1);
        expect(color.g).toBe(0);
        expect(color.b).toBe(0);
      }
    });

    it('解析 rgb 颜色', () => {
      const color = Color.parse('rgb(255, 0, 0)');
      expect(color).toBeDefined();
      if (color) {
        expect(color.r).toBe(1);
        expect(color.g).toBe(0);
        expect(color.b).toBe(0);
      }
    });
  });
});
