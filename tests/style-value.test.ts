import type { CompiledStyleLayer } from '../src/mvt/types';
import { describe, expect, it } from 'vitest';
import { evaluateLayerPaintNumber } from '../src/mvt/style/style-value';

describe('style-value', () => {
  it('falls back when a MapLibre numeric expression evaluates null at runtime', () => {
    const layer: CompiledStyleLayer = {
      filterEvaluator: () => true,
      filterKey: 'all',
      id: 'line-test',
      layout: {},
      layoutKey: 'layout',
      order: 0,
      paint: {
        'line-width': ['+', ['get', 'width'], 1],
      },
      sourceLayer: 'transportation',
      type: 'line',
      visibility: 'visible',
    };
    const cache = new WeakMap();
    cache.set(layer, new Map([
      ['line-width', {
        evaluate: () => {
          throw new Error('Expected value to be of type number, but found null instead.');
        },
      }],
    ]));

    const value = evaluateLayerPaintNumber(
      cache,
      layer,
      'line-width',
      14,
      {
        geometry: [],
        geometryType: 'LineString',
        properties: {
          width: null,
        },
      },
      3,
    );

    expect(value).toBe(3);
  });
});
