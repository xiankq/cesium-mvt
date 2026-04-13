import type { ExpressionContext } from '@/mvt/style/expression-evaluator';
import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '@/mvt/style/expression-evaluator';

function createContext(overrides: Partial<ExpressionContext> = {}): ExpressionContext {
  return {
    properties: {},
    ...overrides,
  };
}

describe('expression-evaluator', () => {
  describe('字面量表达式', () => {
    it('求值字符串字面量', () => {
      const expression = 'red';
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('red');
    });

    it('求数字字面量', () => {
      const expression = 42;
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(42);
    });

    it('求值布尔字面量', () => {
      const expression = true;
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('求值 null', () => {
      const expression = null;
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(null);
    });
  });

  describe('属性访问表达式', () => {
    it('使用 get 访问属性', () => {
      const expression = ['get', 'name'];
      const context = createContext({
        properties: { name: 'Beijing' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe('Beijing');
    });

    it('访问不存在的属性返回 undefined', () => {
      const expression = ['get', 'missing'];
      const context = createContext({
        properties: { name: 'Beijing' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(undefined);
    });

    it('使用 has 检查属性是否存在', () => {
      const expression = ['has', 'name'];
      const context = createContext({
        properties: { name: 'Beijing' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(true);
    });

    it('使用 has 检查不存在的属性', () => {
      const expression = ['has', 'missing'];
      const context = createContext({
        properties: { name: 'Beijing' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(false);
    });

    it('访问 feature id', () => {
      const expression = ['id'];
      const context = createContext({
        id: 123,
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(123);
    });

    it('访问 geometry-type', () => {
      const expression = ['geometry-type'];
      const context = createContext({
        geometryType: 'Point',
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe('Point');
    });

    it('访问 properties', () => {
      const expression = ['properties'];
      const context = createContext({
        properties: { name: 'Beijing' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toEqual({ name: 'Beijing' });
    });

    it('访问 feature-state', () => {
      const expression = ['feature-state', 'hover'];
      const context = createContext({
        featureState: { hover: true },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(true);
    });
  });

  describe('数学运算表达式', () => {
    it('加法运算', () => {
      const expression = ['+', 1, 2];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(3);
    });

    it('多个数字加法', () => {
      const expression = ['+', 1, 2, 3, 4];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(10);
    });

    it('减法运算', () => {
      const expression = ['-', 10, 3];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(7);
    });

    it('负数运算', () => {
      const expression = ['-', 5];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(-5);
    });

    it('乘法运算', () => {
      const expression = ['*', 3, 4];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(12);
    });

    it('多个数字乘法', () => {
      const expression = ['*', 2, 3, 4];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(24);
    });

    it('除法运算', () => {
      const expression = ['/', 10, 2];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(5);
    });

    it('取模运算', () => {
      const expression = ['%', 10, 3];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(1);
    });

    it('幂运算', () => {
      const expression = ['^', 2, 3];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(8);
    });

    it('数学运算与属性访问组合', () => {
      const expression = ['+', ['get', 'value'], 10];
      const context = createContext({
        properties: { value: 5 },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(15);
    });
  });

  describe('比较表达式', () => {
    it('相等比较', () => {
      const expression = ['==', 1, 1];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('不相等比较', () => {
      const expression = ['!=', 1, 2];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('大于比较', () => {
      const expression = ['>', 5, 3];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('大于等于比较', () => {
      const expression = ['>=', 3, 3];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('小于比较', () => {
      const expression = ['<', 3, 5];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('小于等于比较', () => {
      const expression = ['<=', 3, 3];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });
  });

  describe('逻辑表达式', () => {
    it('逻辑与', () => {
      const expression = ['all', true, true];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('逻辑与 - 有一个为 false', () => {
      const expression = ['all', true, false];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(false);
    });

    it('逻辑或', () => {
      const expression = ['any', false, true];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('逻辑非', () => {
      const expression = ['!', true];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(false);
    });
  });

  describe('条件表达式', () => {
    it('case 表达式 - 匹配第一个条件', () => {
      const expression = ['case', true, 'yes', 'no'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('yes');
    });

    it('case 表达式 - 匹配第二个条件', () => {
      const expression = ['case', false, 'yes', true, 'maybe', 'no'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('maybe');
    });

    it('case 表达式 - 使用默认值', () => {
      const expression = ['case', false, 'yes', 'no'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('no');
    });

    it('match 表达式 - 匹配字符串', () => {
      const expression = ['match', ['get', 'type'], 'city', 'urban', 'rural'];
      const context = createContext({
        properties: { type: 'city' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe('urban');
    });

    it('match 表达式 - 使用默认值', () => {
      const expression = ['match', ['get', 'type'], 'city', 'urban', 'rural'];
      const context = createContext({
        properties: { type: 'village' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe('rural');
    });

    it('match 表达式 - 匹配多个值', () => {
      const expression = ['match', ['get', 'type'], ['city', 'town'], 'urban', 'rural'];
      const context = createContext({
        properties: { type: 'town' },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe('urban');
    });

    it('coalesce 表达式 - 返回第一个非 null 值', () => {
      const expression = ['coalesce', null, null, 'found', 'not used'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('found');
    });
  });

  describe('插值表达式', () => {
    it('线性插值', () => {
      const expression = [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1,
        10,
        11,
      ];
      const context = createContext({ zoom: 5 });
      const result = evaluateExpression(expression, context);
      expect(result).toBeCloseTo(6);
    });

    it('线性插值 - 颜色', () => {
      const expression = [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        '#ff0000',
        10,
        '#0000ff',
      ];
      const context = createContext({ zoom: 5 });
      const result = evaluateExpression(expression, context);
      expect(result).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('step 表达式', () => {
      const expression = [
        'step',
        ['zoom'],
        'low',
        10,
        'medium',
        15,
        'high',
      ];
      expect(evaluateExpression(expression, createContext({ zoom: 5 }))).toBe('low');
      expect(evaluateExpression(expression, createContext({ zoom: 10 }))).toBe('medium');
      expect(evaluateExpression(expression, createContext({ zoom: 12 }))).toBe('medium');
      expect(evaluateExpression(expression, createContext({ zoom: 15 }))).toBe('high');
      expect(evaluateExpression(expression, createContext({ zoom: 20 }))).toBe('high');
    });
  });

  describe('zoom 函数', () => {
    it('获取当前 zoom 级别', () => {
      const expression = ['zoom'];
      const context = createContext({ zoom: 10 });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(10);
    });

    it('zoom 用于条件判断', () => {
      const expression = ['case', ['>=', ['zoom'], 10], 'detailed', 'simple'];
      expect(evaluateExpression(expression, createContext({ zoom: 8 }))).toBe('simple');
      expect(evaluateExpression(expression, createContext({ zoom: 12 }))).toBe('detailed');
    });
  });

  describe('类型转换表达式', () => {
    it('to-number', () => {
      const expression = ['to-number', '42'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(42);
    });

    it('to-string', () => {
      const expression = ['to-string', 42];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('42');
    });

    it('to-boolean', () => {
      const expression = ['to-boolean', 1];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(true);
    });

    it('typeof', () => {
      expect(evaluateExpression(['typeof', 'hello'], createContext())).toBe('string');
      expect(evaluateExpression(['typeof', 42], createContext())).toBe('number');
      expect(evaluateExpression(['typeof', true], createContext())).toBe('boolean');
      expect(evaluateExpression(['typeof', null], createContext())).toBe('null');
      expect(evaluateExpression(['typeof', {}], createContext())).toBe('object');
    });
  });

  describe('字符串操作表达式', () => {
    it('concat', () => {
      const expression = ['concat', 'Hello', ' ', 'World'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('Hello World');
    });

    it('downcase', () => {
      const expression = ['downcase', 'HELLO'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('hello');
    });

    it('upcase', () => {
      const expression = ['upcase', 'hello'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('HELLO');
    });

    it('length', () => {
      const expression = ['length', 'hello'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(5);
    });
  });

  describe('数学函数表达式', () => {
    it('abs', () => {
      const expression = ['abs', -5];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(5);
    });

    it('floor', () => {
      const expression = ['floor', 3.7];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(3);
    });

    it('ceil', () => {
      const expression = ['ceil', 3.2];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(4);
    });

    it('round', () => {
      const expression = ['round', 3.5];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(4);
    });

    it('min', () => {
      const expression = ['min', 5, 3, 8, 1];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(1);
    });

    it('max', () => {
      const expression = ['max', 5, 3, 8, 1];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(8);
    });

    it('sqrt', () => {
      const expression = ['sqrt', 16];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(4);
    });

    it('ln', () => {
      const expression = ['ln', Math.E];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(1);
    });

    it('log2', () => {
      const expression = ['log2', 8];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(3);
    });

    it('log10', () => {
      const expression = ['log10', 100];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(2);
    });

    it('sin', () => {
      const expression = ['sin', 0];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(0);
    });

    it('cos', () => {
      const expression = ['cos', 0];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(1);
    });

    it('pi', () => {
      const expression = ['pi'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(Math.PI);
    });

    it('e', () => {
      const expression = ['e'];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBeCloseTo(Math.E);
    });
  });

  describe('数组表达式', () => {
    it('at - 访问数组元素', () => {
      const expression = ['at', 1, ['literal', ['a', 'b', 'c']]];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe('b');
    });

    it('length - 数组长度', () => {
      const expression = ['length', ['literal', [1, 2, 3, 4]]];
      const result = evaluateExpression(expression, createContext());
      expect(result).toBe(4);
    });
  });

  describe('复杂嵌套表达式', () => {
    it('嵌套属性访问和数学运算', () => {
      const expression = ['*', ['+', ['get', 'a'], ['get', 'b']], 2];
      const context = createContext({
        properties: { a: 3, b: 4 },
      });
      const result = evaluateExpression(expression, context);
      expect(result).toBe(14);
    });

    it('复杂条件表达式', () => {
      const expression = [
        'case',
        ['>=', ['get', 'population'], 1000000],
        'large',
        ['>=', ['get', 'population'], 100000],
        'medium',
        'small',
      ];
      expect(
        evaluateExpression(expression, createContext({
          properties: { population: 2000000 },
        })),
      ).toBe('large');
      expect(
        evaluateExpression(expression, createContext({
          properties: { population: 500000 },
        })),
      ).toBe('medium');
      expect(
        evaluateExpression(expression, createContext({
          properties: { population: 50000 },
        })),
      ).toBe('small');
    });
  });
});
