import { describe, expect, it, vi } from 'vitest';
import { createMvtFilterEvaluator } from '../src/mvt/style/mvt-filter';

describe('mvt-filter', () => {
  const feature = {
    geometryType: 'Polygon',
    id: 7,
    properties: {
      adminLevel: 2,
      class: 'park',
      name: 'People Park',
      visible: true,
    },
  };

  it('supports compare operators and special keys', () => {
    expect(createMvtFilterEvaluator(['==', 'class', 'park'])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['!=', 'class', 'water'])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['>=', 'adminLevel', 2])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['==', '$type', 'Polygon'])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['==', '$id', 7])(feature)).toBe(true);
  });

  it('supports logical operators', () => {
    const evaluator = createMvtFilterEvaluator([
      'all',
      ['==', 'class', 'park'],
      ['any', ['==', 'name', 'People Park'], ['==', 'name', 'Century Park']],
      ['none', ['==', 'adminLevel', 3]],
    ]);

    expect(evaluator(feature)).toBe(true);
  });

  it('supports has and in operators', () => {
    expect(createMvtFilterEvaluator(['has', 'name'])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['!has', 'missing'])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['in', 'class', 'park', 'forest'])(feature)).toBe(true);
    expect(createMvtFilterEvaluator(['!in', 'class', 'road', 'water'])(feature)).toBe(true);
  });

  it('suppresses runtime filter warnings caused by null numeric values', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const evaluator = createMvtFilterEvaluator(['>=', ['number', ['get', 'adminLevel']], 1]);

    expect(evaluator({
      ...feature,
      properties: {
        ...feature.properties,
        adminLevel: null,
      },
    })).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
