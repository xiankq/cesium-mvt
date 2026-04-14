import { describe, expect, it } from 'vitest';
import { compareSymbolPlacements } from '@/mvt/render/backend/bucket-symbol-collection-builder';

describe('bucket-symbol-collection-builder', () => {
  it('应该优先按 symbol-sort-key 排序', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 1,
        symbolStyle: {
          sortKey: 10,
        },
      },
      {
        sourceIndex: 0,
        symbolStyle: {
          sortKey: 1,
        },
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([0, 1]);
  });

  it('应该在 viewport-y 模式下按视口纬度倒序排序', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 0,
        viewportLatitude: 10,
        symbolStyle: {},
      },
      {
        sourceIndex: 1,
        viewportLatitude: 20,
        symbolStyle: {},
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([1, 0]);
  });
});
