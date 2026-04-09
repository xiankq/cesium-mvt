import type { Cartesian3 } from '@cesium/engine';
import type { CompiledStyleLayer } from '../types';

/**
 * 图层高度偏移步长（米）
 * 用于区分不同图层的渲染顺序，避免穿模
 */
const LAYER_HEIGHT_STEP = 1.0;

/**
 * Symbol 图标高度偏移
 */
const SYMBOL_ICON_HEIGHT_OFFSET = 0.2;

/**
 * Symbol 文本高度偏移
 */
const SYMBOL_TEXT_HEIGHT_OFFSET = 0.4;

export function getLayerHeightOffset(
  layer: CompiledStyleLayer,
  variant: 'default' | 'symbol-icon' | 'symbol-text' = 'default',
): number {
  const baseOffset = (layer.order + 1) * LAYER_HEIGHT_STEP;

  switch (variant) {
    case 'symbol-icon':
      return baseOffset + SYMBOL_ICON_HEIGHT_OFFSET;
    case 'symbol-text':
      return baseOffset + SYMBOL_TEXT_HEIGHT_OFFSET;
    case 'default':
    default:
      return baseOffset;
  }
}

export function liftLocalPosition(
  position: Cartesian3,
  heightOffset: number,
): Cartesian3 {
  position.z += heightOffset;
  return position;
}
