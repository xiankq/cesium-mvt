import { describe, expect, it } from 'vitest';
import { createSymbolPlacementIndex } from '@/mvt/render/backend/symbol-placement-index';

describe('symbol-placement-index', () => {
  it('应该只把同 key 的近邻 placement 视为匹配', () => {
    const index = createSymbolPlacementIndex();
    const accepted = createPlacement('source|layer|Museum', 15, 0.5, 0.5);
    const farAccepted = createPlacement('source|layer|Museum', 15, 0.9, 0.9);
    const differentKeyAccepted = createPlacement('source|layer|School', 15, 0.5, 0.5);

    index.insert(accepted);
    index.insert(farAccepted);
    index.insert(differentKeyAccepted);

    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.5000001, 0.5000001))).toBe(true);
    expect(index.hasMatch(createPlacement('source|layer|Museum', 15, 0.8, 0.8))).toBe(false);
  });

  it('应该兼容不同 zoom 的同 key placement 匹配', () => {
    const index = createSymbolPlacementIndex();
    index.insert(createPlacement('source|layer|Museum', 15, 0.5, 0.5));

    expect(index.hasMatch(createPlacement('source|layer|Museum', 13, 0.5000005, 0.5000005))).toBe(true);
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
  };
}
