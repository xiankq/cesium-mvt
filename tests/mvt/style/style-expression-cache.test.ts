import { describe, expect, it } from 'vitest';
import { StyleExpressionCache } from '@/mvt/style/style-expression-cache';

describe('style-expression-cache', () => {
  describe('styleExpressionCache', () => {
    it('should cache compiled expressions', () => {
      const cache = new StyleExpressionCache();

      const expression1 = { stops: [[0, 1], [10, 2]] };
      const expression2 = { stops: [[0, 1], [10, 2]] };

      const compiled1 = cache.getOrCreate(expression1, 'number');
      const compiled2 = cache.getOrCreate(expression2, 'number');

      expect(compiled1).toBe(compiled2);
    });

    it('should return different compiled expressions for different inputs', () => {
      const cache = new StyleExpressionCache();

      const expression1 = { stops: [[0, 1], [10, 2]] };
      const expression2 = { stops: [[0, 1], [10, 3]] };

      const compiled1 = cache.getOrCreate(expression1, 'number');
      const compiled2 = cache.getOrCreate(expression2, 'number');

      expect(compiled1).not.toBe(compiled2);
    });

    it('should limit cache size', () => {
      const cache = new StyleExpressionCache({ maxSize: 2 });

      const expression1 = { stops: [[0, 1]] };
      const expression2 = { stops: [[0, 2]] };
      const expression3 = { stops: [[0, 3]] };

      cache.getOrCreate(expression1, 'number');
      cache.getOrCreate(expression2, 'number');
      cache.getOrCreate(expression3, 'number');

      expect(cache.size()).toBe(2);
    });

    it('should clear cache', () => {
      const cache = new StyleExpressionCache();

      const expression = { stops: [[0, 1]] };
      cache.getOrCreate(expression, 'number');

      cache.clear();

      expect(cache.size()).toBe(0);
    });
  });
});
