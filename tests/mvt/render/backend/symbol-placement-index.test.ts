import { describe, expect, it } from 'vitest';
import { createSymbolPlacementIndex } from '@/mvt/render/backend/symbol-placement-index';

describe('symbol-placement-index', () => {
  it('应该只把空间近邻的 placement 视为匹配', () => {
    const index = createSymbolPlacementIndex();
    const accepted = createPlacement('source|layer|Museum', 15, 0.5, 0.5);
    const farAccepted = createPlacement('source|layer|Museum', 15, 0.9, 0.9);
    const differentKeyAccepted = createPlacement('source|layer|School', 15, 0.5, 0.5);

    index.insert(accepted);
    index.insert(farAccepted);
    index.insert(differentKeyAccepted);

    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.5000001, 0.5000001))).toBe(true);
    expect(index.hasMatch(createPlacement('source|layer|School', 15, 0.5000001, 0.5000001))).toBe(true);
    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.8, 0.8))).toBe(false);
  });

  it('应该兼容不同 zoom 的同 key placement 匹配', () => {
    const index = createSymbolPlacementIndex();
    index.insert(createPlacement('source|layer|Museum', 15, 0.5, 0.5));

    expect(index.hasMatch(createPlacement('source|layer|Museum', 13, 0.5000005, 0.5000005))).toBe(true);
  });

  it('应该让同 key 但未重叠的近邻 placement 仍然匹配', () => {
    const index = createSymbolPlacementIndex();
    index.insert(createPlacement('source|layer|Museum', 15, 0.5, 0.5, {
      halfHeight: 0.000001,
      halfWidth: 0.000001,
    }, 'source/15/0/0'));

    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.5000004, 0.5000004, {
      halfHeight: 0.000001,
      halfWidth: 0.000001,
    }, 'source/15/1/0'))).toBe(true);
  });

  it('同 key 的跨 tile 匹配应该是一对一的，不应该把同一个候选重复吃掉', () => {
    const index = createSymbolPlacementIndex();
    index.insert(createPlacement('source|layer|Museum', 0, 0.5, 0.5, {
      halfHeight: 0.000001,
      halfWidth: 0.000001,
    }, 'source/0/0/0'));

    expect(index.hasMatch(createPlacement('source|layer|Museum', 0, 0.51, 0.51, {
      halfHeight: 0.000001,
      halfWidth: 0.000001,
    }, 'source/0/1/0'))).toBe(true);

    expect(index.hasMatch(createPlacement('source|layer|Museum', 0, 0.511, 0.511, {
      halfHeight: 0.000001,
      halfWidth: 0.000001,
    }, 'source/0/2/0'))).toBe(false);
  });

  it('应该忽略 overlapMode 为 always 的 placement', () => {
    const index = createSymbolPlacementIndex();
    index.insert(createPlacement('source|layer|Museum', 15, 0.5, 0.5));

    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.5, 0.5, {
      overlapMode: 'always',
    }))).toBe(false);
  });

  it('应该在大碰撞盒下保持可用', () => {
    const index = createSymbolPlacementIndex();
    index.insert(createPlacement('source|layer|Museum', 15, 0.5, 0.5, {
      halfHeight: 1,
      halfWidth: 1,
    }));

    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.5000001, 0.5000001))).toBe(true);
  });
});

function createPlacement(
  key: string,
  level: number,
  anchorX: number,
  anchorY: number,
  collisionOverrides: Partial<{
    blocksOtherSymbols: boolean;
    centerOffsetX: number;
    centerOffsetY: number;
    halfHeight: number;
    halfWidth: number;
    overlapMode: 'always' | 'cooperative' | 'never';
  }> = {},
  tileKey = `source/${level}/0/0`,
) {
  return {
    anchorX,
    anchorY,
    collision: {
      blocksOtherSymbols: true,
      centerOffsetX: 0,
      centerOffsetY: 0,
      halfHeight: 0.02,
      halfWidth: 0.02,
      overlapMode: 'never' as const,
      ...collisionOverrides,
    },
    key,
    level,
    tileKey,
  };
}
