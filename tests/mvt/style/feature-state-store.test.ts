import { describe, expect, it } from 'vitest';
import { FeatureStateStore } from '@/mvt/style/feature-state-store';

describe('feature-state-store', () => {
  it('会合并 source 级和 source-layer 级的 feature-state', () => {
    const store = new FeatureStateStore();

    expect(store.setFeatureState({
      id: 7,
      sourceId: 'base',
    }, {
      active: false,
      count: 1,
    })).toBe(true);

    expect(store.setFeatureState({
      id: 7,
      sourceId: 'base',
      sourceLayer: 'roads',
    }, {
      active: true,
    })).toBe(true);

    expect(store.getFeatureState({
      id: 7,
      sourceId: 'base',
    })).toEqual({
      active: false,
      count: 1,
    });

    expect(store.getFeatureState({
      id: 7,
      sourceId: 'base',
      sourceLayer: 'roads',
    })).toEqual({
      active: true,
      count: 1,
    });
  });
});
