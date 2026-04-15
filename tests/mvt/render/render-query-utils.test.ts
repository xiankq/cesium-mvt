import { describe, expect, it } from 'vitest';
import { getVisibleSymbolSourceIndexes, resolveSourceLayerNames } from '@/mvt/render/render-query-utils';

describe('render-query-utils', () => {
  it('应该优先使用 TileSpatialIndex 缓存的 sourceLayerNames', () => {
    const tileIndex = {
      layers: {
        keys() {
          throw new Error('should not be called');
        },
      },
      sourceLayerNames: ['poi', 'road'],
    } as any;

    const sourceLayerNames = resolveSourceLayerNames(
      {
        source: 'base',
      },
      {
        type: 'vector',
        tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
      } as any,
      tileIndex,
    );

    expect(sourceLayerNames).toEqual(['poi', 'road']);
  });

  it('应该优先返回预计算的可见 symbol source index 缓存', () => {
    const visibleSourceIndexes = new Set<number>([1, 3]);
    const cachedIndex = new Map<string, Map<string, Set<number>>>([
      ['poi-layer', new Map<string, Set<number>>([
        ['layer', visibleSourceIndexes],
      ])],
    ]);

    const handle = {
      symbols: {
        placements: [
          {
            layerId: 'poi-layer',
            renderables: [
              {
                collection: {
                  get() {
                    throw new Error('should not be called');
                  },
                },
                index: 0,
              },
            ],
            sourceIndex: 0,
            sourceLayer: 'layer',
          },
        ],
        visibleSourceIndexesByLayerAndSourceLayer: cachedIndex,
      },
    } as any;

    const result = getVisibleSymbolSourceIndexes(handle, 'poi-layer', 'layer');

    expect(result).toBe(visibleSourceIndexes);
  });
});
