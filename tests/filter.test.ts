import { describe, expect, it, vi } from 'vitest';
import { createFilterEvaluator } from '../src/mvt/style/filter';

describe('filter', () => {
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
    expect(createFilterEvaluator(['==', 'class', 'park'])(feature)).toBe(true);
    expect(createFilterEvaluator(['!=', 'class', 'water'])(feature)).toBe(true);
    expect(createFilterEvaluator(['>=', 'adminLevel', 2])(feature)).toBe(true);
    expect(createFilterEvaluator(['==', '$type', 'Polygon'])(feature)).toBe(true);
    expect(createFilterEvaluator(['==', '$id', 7])(feature)).toBe(true);
  });

  it('supports logical operators', () => {
    const evaluator = createFilterEvaluator([
      'all',
      ['==', 'class', 'park'],
      ['any', ['==', 'name', 'People Park'], ['==', 'name', 'Century Park']],
      ['none', ['==', 'adminLevel', 3]],
    ]);

    expect(evaluator(feature)).toBe(true);
  });

  it('supports has and in operators', () => {
    expect(createFilterEvaluator(['has', 'name'])(feature)).toBe(true);
    expect(createFilterEvaluator(['!has', 'missing'])(feature)).toBe(true);
    expect(createFilterEvaluator(['in', 'class', 'park', 'forest'])(feature)).toBe(true);
    expect(createFilterEvaluator(['!in', 'class', 'road', 'water'])(feature)).toBe(true);
  });

  it('suppresses runtime filter warnings caused by null numeric values', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const evaluator = createFilterEvaluator(['>=', ['number', ['get', 'adminLevel']], 1]);

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
