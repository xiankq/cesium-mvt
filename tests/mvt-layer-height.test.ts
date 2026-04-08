import type { MvtCompiledStyleLayer } from '../src/mvt/mvt-types';
import { describe, expect, it } from 'vitest';
import { getLayerHeightOffset } from '../src/mvt/render/mvt-layer-height';

function createLayer(order: number): MvtCompiledStyleLayer {
  return {
    filterEvaluator: () => true,
    filterKey: 'null',
    id: `layer-${order}`,
    layout: {},
    layoutKey: '{}',
    order,
    paint: {},
    type: 'symbol',
    visibility: 'visible',
  };
}

describe('mvt-layer-height', () => {
  it('keeps later layers and symbol text above earlier geometry', () => {
    const layer = createLayer(10);

    expect(getLayerHeightOffset(createLayer(1))).toBeLessThan(getLayerHeightOffset(layer));
    expect(getLayerHeightOffset(layer, 'symbol-icon')).toBeGreaterThan(getLayerHeightOffset(layer));
    expect(getLayerHeightOffset(layer, 'symbol-text')).toBeGreaterThan(getLayerHeightOffset(layer, 'symbol-icon'));
  });
});
