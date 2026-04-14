import { describe, expect, it } from 'vitest';
import { createSymbolPlacementGrid } from '@/mvt/render/backend/symbol-placement-grid';
import {
  createSymbolPlacementKey,
  resolveIconPlacement,
} from '@/mvt/render/backend/symbol-placement-resolver';

describe('symbol-placement-resolver', () => {
  it('应该在文本存在时忽略图标差异生成 placement key', () => {
    const leftKey = createSymbolPlacementKey(
      'source',
      'layer',
      {
        iconImage: 'icon-a',
      } as any,
      'Museum',
    );
    const rightKey = createSymbolPlacementKey(
      'source',
      'layer',
      {
        iconImage: 'icon-b',
      } as any,
      'Museum',
    );

    expect(leftKey).toBe(rightKey);
  });

  it('应该为图标 placement 使用默认中心锚点', () => {
    const placement = resolveIconPlacement(
      {
        textAnchor: undefined,
      } as any,
      {
        height: 1,
        image: 'data:image/png;base64,icon',
        pixelRatio: 1,
        width: 1,
      } as any,
      256,
      0,
      {
        level: 0,
        x: 0,
        y: 0,
      },
      createSymbolPlacementGrid(),
      {
        anchorX: 0.5,
        anchorY: 0.5,
        key: 'source|layer|Museum',
        layerId: 'layer',
      },
    );

    expect(placement?.iconAnchor).toBe('center');
  });
});
