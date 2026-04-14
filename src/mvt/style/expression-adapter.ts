import type {
  Feature,
  FeatureState,
  GlobalProperties,
  ICanonicalTileID,
  StyleExpression,
  StylePropertyExpression,
  Type,
  ValidationError,
} from '@maplibre/maplibre-gl-style-spec';
import {
  Color,
  ColorType,
  CompoundExpression,
  createExpression,
  createPropertyExpression,
  EvaluationContext,
  featureFilter,
  FormatExpression,
  Formatted,
  Interpolate,
  isExpression,
  Literal,
  normalizePropertyExpression,
  NullType,
  Padding,
  ParsingError,
  ResolvedImage,
  Step,
  typeOf,
} from '@maplibre/maplibre-gl-style-spec';

export {
  Color,
  ColorType,
  CompoundExpression,
  createExpression,
  createPropertyExpression,
  EvaluationContext,
  featureFilter,
  FormatExpression,
  Formatted,
  Interpolate,
  isExpression,
  Literal,
  normalizePropertyExpression,
  NullType,
  Padding,
  ParsingError,
  ResolvedImage,
  Step,
  typeOf,
};

export type {
  Feature,
  FeatureState,
  GlobalProperties,
  ICanonicalTileID,
  StyleExpression,
  StylePropertyExpression,
  Type,
  ValidationError,
};

export interface ExpressionEvaluateOptions {
  zoom: number;
  feature?: Feature;
  featureState?: FeatureState;
  canonical?: ICanonicalTileID;
  availableImages?: string[];
}

export function evaluateExpression(
  expression: StyleExpression,
  options: ExpressionEvaluateOptions,
): unknown {
  const globals: GlobalProperties = {
    zoom: options.zoom,
  };

  return expression.evaluate(
    globals,
    options.feature,
    options.featureState,
    options.canonical,
    options.availableImages,
  );
}

export interface PropertyEvaluateOptions {
  zoom: number;
  feature?: Feature;
  featureState?: FeatureState;
  canonical?: ICanonicalTileID;
}

export function evaluateProperty(
  property: StylePropertyExpression,
  options: PropertyEvaluateOptions,
): unknown {
  const globals: GlobalProperties = {
    zoom: options.zoom,
  };

  return property.evaluate(
    globals,
    options.feature,
    options.featureState,
    options.canonical,
  );
}

export interface FilterEvaluateOptions {
  zoom: number;
  feature: Feature;
  canonical?: ICanonicalTileID;
}

export function evaluateFilter(
  filter: { filter: (globals: GlobalProperties, feature: Feature, canonical?: ICanonicalTileID) => boolean },
  options: FilterEvaluateOptions,
): boolean {
  const globals: GlobalProperties = {
    zoom: options.zoom,
  };

  return filter.filter(globals, options.feature, options.canonical);
}
