import type { Cartesian3 } from '@cesium/engine';
import type { MvtCompiledStyleLayer } from '../mvt-types';

const layerOrderHeightStep = 0.25;

export function getLayerHeightOffset(
  layer: MvtCompiledStyleLayer,
  variant: 'default' | 'symbol-icon' | 'symbol-text' = 'default',
): number {
  const baseOffset = (layer.order + 1) * layerOrderHeightStep;

  switch (variant) {
    case 'symbol-icon':
      return baseOffset + 0.05;
    case 'symbol-text':
      return baseOffset + 0.1;
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
