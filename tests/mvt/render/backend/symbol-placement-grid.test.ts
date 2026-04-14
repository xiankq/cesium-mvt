import { describe, expect, it } from 'vitest';
import { createSymbolPlacementGrid } from '@/mvt/render/backend/symbol-placement-grid';

describe('symbol-placement-grid', () => {
  it('应该只返回空间相邻的 placement', () => {
    const grid = createSymbolPlacementGrid();
    const nearAccepted = createPlacement('source|layer|Museum', 0.12, 0.12);
    const farAccepted = createPlacement('source|layer|Museum', 0.9, 0.9);
    const differentKeyAccepted = createPlacement('source|layer|School', 0.12, 0.12);

    grid.insert(nearAccepted);
    grid.insert(farAccepted);
    grid.insert(differentKeyAccepted);

    const candidates = grid.query(createPlacement('source|layer|Museum', 0.13, 0.13));

    expect(candidates).toHaveLength(2);
    expect(candidates).toContain(nearAccepted);
    expect(candidates).toContain(differentKeyAccepted);
  });

  it('应该去重跨多个 cell 的 placement', () => {
    const grid = createSymbolPlacementGrid();
    const accepted = createPlacement('source|layer|Museum', 0.45, 0.45, {
      halfHeight: 0.12,
      halfWidth: 0.12,
    });

    grid.insert(accepted);

    const candidates = grid.query(createPlacement('source|layer|Museum', 0.46, 0.46, {
      halfHeight: 0.04,
      halfWidth: 0.04,
    }));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBe(accepted);
  });

  it('应该忽略不会阻挡其他符号的 placement', () => {
    const grid = createSymbolPlacementGrid();
    const accepted = createPlacement('source|layer|Museum', 0.5, 0.5, {
      blocksOtherSymbols: false,
    });

    grid.insert(accepted);

    const candidates = grid.query(createPlacement('source|layer|Museum', 0.5, 0.5));

    expect(candidates).toHaveLength(0);
  });
});

function createPlacement(
  key: string,
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
  };
}
