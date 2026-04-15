import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureFilterContext } from '@/mvt/style/filter-adapter';
import { describe, expect, it, vi } from 'vitest';
import { createFeatureFilter } from '@/mvt/style/filter-adapter';

function createContext(overrides: {
  canonical?: FeatureFilterContext['canonical'];
  feature?: Partial<Feature>;
  geometryType?: 'LineString' | 'Point' | 'Polygon';
  id?: Feature['id'];
  featureState?: FeatureFilterContext['featureState'];
  properties?: Record<string, unknown>;
  zoom?: number;
} = {}): FeatureFilterContext {
  const geometryType = overrides.geometryType ?? 'Point';
  return {
    canonical: overrides.canonical,
    feature: {
      id: overrides.id,
      properties: overrides.properties ?? {},
      type: geometryType,
      ...overrides.feature,
    } as Feature,
    featureState: overrides.featureState,
    zoom: overrides.zoom ?? 0,
  };
}

describe('feature-filter', () => {
  describe('基础过滤器', () => {
    it('空过滤器返回 true', () => {
      const filter = createFeatureFilter(null);
      expect(filter(createContext())).toBe(true);
    });

    it('true 过滤器返回 true', () => {
      const filter = createFeatureFilter(true);
      expect(filter(createContext())).toBe(true);
    });

    it('false 过滤器返回 false', () => {
      const filter = createFeatureFilter(false);
      expect(filter(createContext())).toBe(false);
    });

    it('应该复用相同 filter 的编译结果', () => {
      const filterSpec: FilterSpecification = ['==', ['get', 'cache-key'], 'value'];

      const compiled1 = createFeatureFilter(filterSpec);
      const compiled2 = createFeatureFilter([
        '==',
        ['get', 'cache-key'],
        'value',
      ] as FilterSpecification);

      expect(compiled1).toBe(compiled2);
    });
  });

  describe('比较过滤器', () => {
    it('== 过滤器', () => {
      const filter = createFeatureFilter(['==', ['get', 'type'], 'city'] as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(true);
      expect(filter(createContext({ properties: { type: 'village' } }))).toBe(false);
    });

    it('!= 过滤器', () => {
      const filter = createFeatureFilter(['!=', ['get', 'type'], 'city'] as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(false);
      expect(filter(createContext({ properties: { type: 'village' } }))).toBe(true);
    });

    it('> 过滤器', () => {
      const filter = createFeatureFilter(['>', ['get', 'population'], 100000] as FilterSpecification);
      expect(filter(createContext({ properties: { population: 200000 } }))).toBe(true);
      expect(filter(createContext({ properties: { population: 50000 } }))).toBe(false);
    });

    it('>= 过滤器', () => {
      const filter = createFeatureFilter(['>=', ['get', 'population'], 100000] as FilterSpecification);
      expect(filter(createContext({ properties: { population: 100000 } }))).toBe(true);
      expect(filter(createContext({ properties: { population: 50000 } }))).toBe(false);
    });

    it('< 过滤器', () => {
      const filter = createFeatureFilter(['<', ['get', 'population'], 100000] as FilterSpecification);
      expect(filter(createContext({ properties: { population: 50000 } }))).toBe(true);
      expect(filter(createContext({ properties: { population: 200000 } }))).toBe(false);
    });

    it('<= 过滤器', () => {
      const filter = createFeatureFilter(['<=', ['get', 'population'], 100000] as FilterSpecification);
      expect(filter(createContext({ properties: { population: 100000 } }))).toBe(true);
      expect(filter(createContext({ properties: { population: 200000 } }))).toBe(false);
    });

    it('比较过滤器在 null 时静默回退 false', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const filter = createFeatureFilter(['<', ['get', 'population'], 100000] as FilterSpecification);

      expect(filter(createContext({ properties: { population: null } }))).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('逻辑过滤器', () => {
    it('all 过滤器（逻辑与）', () => {
      const filter = createFeatureFilter([
        'all',
        ['==', ['get', 'type'], 'city'],
        ['>', ['get', 'population'], 100000],
      ] as FilterSpecification);
      expect(filter(createContext({
        properties: { type: 'city', population: 200000 },
      }))).toBe(true);
      expect(filter(createContext({
        properties: { type: 'city', population: 50000 },
      }))).toBe(false);
      expect(filter(createContext({
        properties: { type: 'village', population: 200000 },
      }))).toBe(false);
    });

    it('any 过滤器（逻辑或）', () => {
      const filter = createFeatureFilter([
        'any',
        ['==', ['get', 'type'], 'city'],
        ['==', ['get', 'type'], 'town'],
      ] as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(true);
      expect(filter(createContext({ properties: { type: 'town' } }))).toBe(true);
      expect(filter(createContext({ properties: { type: 'village' } }))).toBe(false);
    });

    it('! 过滤器（逻辑非）', () => {
      const filter = createFeatureFilter(['!', ['==', ['get', 'type'], 'city']] as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(false);
      expect(filter(createContext({ properties: { type: 'village' } }))).toBe(true);
    });

    it('none 过滤器（全部不满足）', () => {
      const filter = createFeatureFilter([
        'none',
        ['==', ['get', 'type'], 'city'],
        ['==', ['get', 'type'], 'town'],
      ] as unknown as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(false);
      expect(filter(createContext({ properties: { type: 'town' } }))).toBe(false);
      expect(filter(createContext({ properties: { type: 'village' } }))).toBe(true);
    });
  });

  describe('存在性过滤器', () => {
    it('has 过滤器', () => {
      const filter = createFeatureFilter(['has', 'name']);
      expect(filter(createContext({ properties: { name: 'Beijing' } }))).toBe(true);
      expect(filter(createContext({ properties: {} }))).toBe(false);
    });

    it('!has 过滤器', () => {
      const filter = createFeatureFilter(['!has', 'name']);
      expect(filter(createContext({ properties: { name: 'Beijing' } }))).toBe(false);
      expect(filter(createContext({ properties: {} }))).toBe(true);
    });
  });

  describe('成员过滤器', () => {
    it('in 过滤器', () => {
      const filter = createFeatureFilter(['in', ['get', 'type'], 'city', 'town', 'village'] as unknown as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(true);
      expect(filter(createContext({ properties: { type: 'town' } }))).toBe(true);
      expect(filter(createContext({ properties: { type: 'road' } }))).toBe(false);
    });

    it('in 过滤器支持字面量 needle', () => {
      const filter = createFeatureFilter(['in', 42, 7, 42] as unknown as FilterSpecification);
      expect(filter(createContext())).toBe(true);
    });

    it('in 过滤器在空候选集时返回 false', () => {
      const filter = createFeatureFilter(['in', ['get', 'type']] as unknown as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(false);
    });

    it('!in 过滤器', () => {
      const filter = createFeatureFilter(['!in', ['get', 'type'], 'city', 'town'] as unknown as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(false);
      expect(filter(createContext({ properties: { type: 'town' } }))).toBe(false);
      expect(filter(createContext({ properties: { type: 'village' } }))).toBe(true);
    });

    it('!in 过滤器在空候选集时返回 true', () => {
      const filter = createFeatureFilter(['!in', ['get', 'type']] as unknown as FilterSpecification);
      expect(filter(createContext({ properties: { type: 'city' } }))).toBe(true);
    });
  });

  describe('feature-state 过滤器', () => {
    it('能够读取 feature-state', () => {
      const filter = createFeatureFilter([
        '==',
        ['feature-state', 'selected'],
        true,
      ] as FilterSpecification);

      expect(filter(createContext({
        featureState: {
          selected: true,
        },
      }))).toBe(true);
      expect(filter(createContext({
        featureState: {
          selected: false,
        },
      }))).toBe(false);
    });
  });

  describe('几何类型过滤器', () => {
    it('$type 过滤器', () => {
      const filter = createFeatureFilter(['==', ['geometry-type'], 'Point'] as FilterSpecification);
      expect(filter(createContext({ geometryType: 'Point' }))).toBe(true);
      expect(filter(createContext({ geometryType: 'LineString' }))).toBe(false);
    });

    it('in $type 过滤器', () => {
      const filter = createFeatureFilter(['in', ['geometry-type'], 'Point', 'LineString'] as unknown as FilterSpecification);
      expect(filter(createContext({ geometryType: 'Point' }))).toBe(true);
      expect(filter(createContext({ geometryType: 'LineString' }))).toBe(true);
      expect(filter(createContext({ geometryType: 'Polygon' }))).toBe(false);
    });
  });

  describe('iD 过滤器', () => {
    it('$id 过滤器', () => {
      const filter = createFeatureFilter(['==', ['id'], 123] as FilterSpecification);
      expect(filter(createContext({ id: 123 }))).toBe(true);
      expect(filter(createContext({ id: 456 }))).toBe(false);
    });
  });

  describe('zoom 过滤器', () => {
    it('基于 zoom 的过滤', () => {
      const filter = createFeatureFilter(['>=', ['zoom'], 10] as FilterSpecification);
      expect(filter(createContext({ zoom: 5 }))).toBe(false);
      expect(filter(createContext({ zoom: 10 }))).toBe(true);
      expect(filter(createContext({ zoom: 15 }))).toBe(true);
    });
  });

  describe('复杂嵌套过滤器', () => {
    it('嵌套逻辑过滤器', () => {
      const filter = createFeatureFilter([
        'all',
        ['>=', ['zoom'], 10],
        [
          'any',
          ['==', ['get', 'type'], 'city'],
          ['all', ['==', ['get', 'type'], 'town'], ['>', ['get', 'population'], 10000]],
        ],
      ] as FilterSpecification);

      expect(filter(createContext({
        zoom: 12,
        properties: { type: 'city' },
      }))).toBe(true);

      expect(filter(createContext({
        zoom: 12,
        properties: { type: 'town', population: 20000 },
      }))).toBe(true);

      expect(filter(createContext({
        zoom: 12,
        properties: { type: 'town', population: 5000 },
      }))).toBe(false);

      expect(filter(createContext({
        zoom: 5,
        properties: { type: 'city' },
      }))).toBe(false);
    });
  });

  describe('类型转换', () => {
    it('to-number 在过滤器中', () => {
      const filter = createFeatureFilter(['>', ['to-number', ['get', 'value']], 10] as FilterSpecification);
      expect(filter(createContext({ properties: { value: '20' } }))).toBe(true);
      expect(filter(createContext({ properties: { value: '5' } }))).toBe(false);
    });
  });
});
