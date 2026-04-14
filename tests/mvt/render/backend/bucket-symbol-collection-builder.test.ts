import { describe, expect, it } from 'vitest';
import { compareSymbolPlacements } from '@/mvt/render/backend/bucket-symbol-collection-builder';

describe('bucket-symbol-collection-builder', () => {
  it('应该优先按 symbol-sort-key 排序', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 1,
        symbolStyle: {
          sortKey: 10,
          sortKeyIsConstant: false,
        },
      },
      {
        sourceIndex: 0,
        symbolStyle: {
          sortKey: 1,
          sortKeyIsConstant: false,
        },
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([0, 1]);
  });

  it('在 auto 且允许重叠时应该按视口纬度倒序排序', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 0,
        viewportLatitude: 10,
        symbolStyle: {
          textAllowOverlap: true,
          zOrder: 'auto',
        },
      },
      {
        sourceIndex: 1,
        viewportLatitude: 20,
        symbolStyle: {
          textAllowOverlap: true,
          zOrder: 'auto',
        },
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([1, 0]);
  });

  it('在 auto 且无法重叠时不应该按视口纬度强制重排', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 0,
        viewportLatitude: 10,
        symbolStyle: {
          iconAllowOverlap: false,
          iconIgnorePlacement: false,
          textAllowOverlap: false,
          textIgnorePlacement: false,
          zOrder: 'auto',
        },
      },
      {
        sourceIndex: 1,
        viewportLatitude: 20,
        symbolStyle: {
          iconAllowOverlap: false,
          iconIgnorePlacement: false,
          textAllowOverlap: false,
          textIgnorePlacement: false,
          zOrder: 'auto',
        },
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([0, 1]);
  });

  it('常量 symbol-sort-key 不应该阻止 auto 下的视口纬度排序', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 0,
        viewportLatitude: 10,
        symbolStyle: {
          sortKey: 0,
          sortKeyIsConstant: true,
          textAllowOverlap: true,
          zOrder: 'auto',
        },
      },
      {
        sourceIndex: 1,
        viewportLatitude: 20,
        symbolStyle: {
          sortKey: 0,
          sortKeyIsConstant: true,
          textAllowOverlap: true,
          zOrder: 'auto',
        },
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([1, 0]);
  });

  it('viewport-y 不应该被 data-driven symbol-sort-key 抢走优先级', () => {
    const placements: Array<any> = [
      {
        sourceIndex: 0,
        viewportLatitude: 10,
        symbolStyle: {
          sortKey: 1,
          sortKeyIsConstant: false,
          textAllowOverlap: true,
          zOrder: 'viewport-y',
        },
      },
      {
        sourceIndex: 1,
        viewportLatitude: 20,
        symbolStyle: {
          sortKey: 10,
          sortKeyIsConstant: false,
          textAllowOverlap: true,
          zOrder: 'viewport-y',
        },
      },
    ];

    placements.sort(compareSymbolPlacements);

    expect(placements.map(entry => entry.sourceIndex)).toEqual([1, 0]);
  });
});
