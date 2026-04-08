import type { MvtBucketFeature, MvtCompiledStyleLayer } from '../mvt-types';
import type { MvtStyleSet } from '../style/mvt-style-set';
import { Cartesian2, Color, HorizontalOrigin, VerticalOrigin } from '@cesium/engine';

export function resolveSymbolBoolean(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature: MvtBucketFeature,
  fallbackValue: boolean,
): boolean {
  const value = styleSet.evaluateLayoutValue(layer, propertyName, zoom, feature);
  return typeof value === 'boolean' ? value : fallbackValue;
}

export function resolveSymbolTranslate(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  propertyName: 'icon-translate' | 'text-translate',
  zoom: number,
  feature: MvtBucketFeature,
): Cartesian2 {
  const translateValue = styleSet.evaluatePaintValue(layer, propertyName, zoom, feature);
  if (!Array.isArray(translateValue) || translateValue.length < 2) {
    return Cartesian2.ZERO;
  }

  const [translateX, translateY] = translateValue;
  if (typeof translateX !== 'number' || typeof translateY !== 'number') {
    return Cartesian2.ZERO;
  }

  return new Cartesian2(translateX, -translateY);
}

export function resolveRotationAlignment(value: unknown): 'map' | 'viewport' {
  return value === 'viewport' ? 'viewport' : 'map';
}

export function resolveOrigins(anchor?: string): {
  horizontalOrigin: HorizontalOrigin;
  verticalOrigin: VerticalOrigin;
} {
  switch (anchor) {
    case 'left':
      return { horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER };
    case 'right':
      return { horizontalOrigin: HorizontalOrigin.RIGHT, verticalOrigin: VerticalOrigin.CENTER };
    case 'top':
      return { horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.TOP };
    case 'bottom':
      return { horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.BOTTOM };
    case 'top-left':
      return { horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.TOP };
    case 'top-right':
      return { horizontalOrigin: HorizontalOrigin.RIGHT, verticalOrigin: VerticalOrigin.TOP };
    case 'bottom-left':
      return { horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.BOTTOM };
    case 'bottom-right':
      return { horizontalOrigin: HorizontalOrigin.RIGHT, verticalOrigin: VerticalOrigin.BOTTOM };
    case 'center':
    default:
      return { horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER };
  }
}

export function withOpacity(color: Color, opacity: number): Color {
  return new Color(
    color.red,
    color.green,
    color.blue,
    color.alpha * Math.max(0, Math.min(1, opacity)),
  );
}
