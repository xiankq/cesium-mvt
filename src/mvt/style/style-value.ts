import type { BucketFeature, CompiledStyleLayer, RenderableLayerType } from '../types';
import { Color } from '@cesium/engine';
import { createPropertyExpression, latest } from '@maplibre/maplibre-gl-style-spec';

interface PropertyExpression {
  evaluate: (
    globals: { zoom: number },
    feature?: {
      id?: unknown;
      properties?: Record<string, unknown>;
      type?: string;
    },
  ) => unknown;
}

type PaintSpecification = Record<string, { default?: unknown } & Record<string, unknown>>;
type LayoutSpecification = Record<string, { default?: unknown } & Record<string, unknown>>;
export type StyleExpressionCache = WeakMap<
  CompiledStyleLayer,
  Map<string, PropertyExpression | null>
>;

const paintSpecificationByType: Record<RenderableLayerType, PaintSpecification> = {
  background: latest.paint_background as PaintSpecification,
  circle: latest.paint_circle as PaintSpecification,
  fill: latest.paint_fill as PaintSpecification,
  line: latest.paint_line as PaintSpecification,
  symbol: latest.paint_symbol as PaintSpecification,
};

const layoutSpecificationByType: Record<RenderableLayerType, LayoutSpecification> = {
  background: latest.layout_background as LayoutSpecification,
  circle: latest.layout_circle as LayoutSpecification,
  fill: latest.layout_fill as LayoutSpecification,
  line: latest.layout_line as LayoutSpecification,
  symbol: latest.layout_symbol as LayoutSpecification,
};

export function evaluateLayerPaintColor(
  cache: StyleExpressionCache,
  layer: CompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature: BucketFeature | undefined,
  fallbackColor: Color,
): Color {
  const value = evaluateLayerPaintValue(cache, layer, propertyName, zoom, feature);

  if (value instanceof Color) {
    return Color.clone(value);
  }
  if (isMapLibreColor(value)) {
    const [r, g, b, a] = value.rgb;
    return new Color(r, g, b, a);
  }
  if (isMapLibreColorLike(value)) {
    return unpremultiplyColor(value.r, value.g, value.b, value.a);
  }
  if (typeof value === 'string') {
    return Color.fromCssColorString(value) ?? Color.clone(fallbackColor);
  }

  return Color.clone(fallbackColor);
}

function isMapLibreColorLike(value: unknown): value is { a: number; b: number; g: number; r: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.r === 'number'
    && typeof candidate.g === 'number'
    && typeof candidate.b === 'number'
    && typeof candidate.a === 'number';
}

function unpremultiplyColor(r: number, g: number, b: number, a: number): Color {
  if (a <= 0 || a >= 1) {
    return new Color(r, g, b, a);
  }
  return new Color(r / a, g / a, b / a, a);
}

export function evaluateLayerPaintNumber(
  cache: StyleExpressionCache,
  layer: CompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature: BucketFeature | undefined,
  fallbackValue: number,
): number {
  const value = evaluateLayerPaintValue(cache, layer, propertyName, zoom, feature);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return fallbackValue;
}

export function evaluateLayerPaintValue(
  cache: StyleExpressionCache,
  layer: CompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature?: BucketFeature,
): unknown {
  const expression = getOrCreatePropertyExpression(cache, layer, propertyName, 'paint');
  if (!expression) {
    return layer.paint[propertyName];
  }

  return evaluatePropertyExpression(expression, zoom, feature);
}

export function evaluateLayerLayoutNumber(
  cache: StyleExpressionCache,
  layer: CompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature: BucketFeature | undefined,
  fallbackValue: number,
): number {
  const value = evaluateLayerLayoutValue(cache, layer, propertyName, zoom, feature);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return fallbackValue;
}

export function evaluateLayerLayoutValue(
  cache: StyleExpressionCache,
  layer: CompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature?: BucketFeature,
): unknown {
  const expression = getOrCreatePropertyExpression(cache, layer, propertyName, 'layout');
  if (!expression) {
    return layer.layout[propertyName];
  }

  return evaluatePropertyExpression(expression, zoom, feature);
}

function evaluatePropertyExpression(
  expression: PropertyExpression,
  zoom: number,
  feature?: BucketFeature,
): unknown {
  try {
    return expression.evaluate({ zoom }, createExpressionFeature(feature));
  }
  catch {
    return undefined;
  }
}

function createExpressionFeature(feature?: BucketFeature): {
  id?: unknown;
  properties: Record<string, unknown>;
  type?: string;
} {
  return {
    id: feature?.id,
    properties: feature?.properties ?? {},
    type: feature?.geometryType,
  };
}

function getOrCreatePropertyExpression(
  cache: StyleExpressionCache,
  layer: CompiledStyleLayer,
  propertyName: string,
  section: 'layout' | 'paint',
): PropertyExpression | null {
  let layerCache = cache.get(layer);
  if (!layerCache) {
    layerCache = new Map();
    cache.set(layer, layerCache);
  }

  if (layerCache.has(propertyName)) {
    return layerCache.get(propertyName) ?? null;
  }

  const propertySpecification = section === 'paint'
    ? paintSpecificationByType[layer.type]?.[propertyName]
    : layoutSpecificationByType[layer.type]?.[propertyName];
  if (!propertySpecification) {
    layerCache.set(propertyName, null);
    return null;
  }

  const expressionInput = section === 'paint'
    ? layer.paint[propertyName] ?? propertySpecification.default
    : layer.layout[propertyName] ?? propertySpecification.default;
  if (expressionInput === undefined) {
    layerCache.set(propertyName, null);
    return null;
  }

  const expressionResult = createPropertyExpression(expressionInput, propertySpecification as any);
  if (expressionResult.result !== 'success') {
    layerCache.set(propertyName, null);
    return null;
  }

  const expression = expressionResult.value as PropertyExpression;
  layerCache.set(propertyName, expression);
  return expression;
}

interface MapLibreColor {
  a: number;
  b: number;
  g: number;
  r: number;
  rgb: [number, number, number, number];
}

function isMapLibreColor(value: unknown): value is MapLibreColor {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.r === 'number'
    && typeof candidate.g === 'number'
    && typeof candidate.b === 'number'
    && typeof candidate.a === 'number'
    && typeof candidate.rgb !== 'undefined';
}
