import type { Color, Feature, FeatureState, GlobalProperties, ICanonicalTileID, StylePropertyExpression } from '@maplibre/maplibre-gl-style-spec';
import {

  createPropertyExpression,

} from '@maplibre/maplibre-gl-style-spec';

export type {
  Color,
  Feature,
  FeatureState,
  GlobalProperties,
  ICanonicalTileID,
  StylePropertyExpression,
};

export interface StylePropertyContext {
  zoom: number;
  feature?: Feature;
  featureState?: FeatureState;
  canonical?: ICanonicalTileID;
}

export interface CreatePropertyEvaluatorOptions<T> {
  value: unknown;
  defaultValue: T;
  specification: PropertySpecification;
}

export interface PropertySpecification {
  type: 'string' | 'number' | 'boolean' | 'color';
  default?: unknown;
  transition?: boolean;
}

export function createPropertyEvaluator<T = unknown>(
  options: CreatePropertyEvaluatorOptions<T>,
): (context: StylePropertyContext) => T {
  const result = createPropertyExpression(
    options.value,
    options.specification as any,
  );

  if (result.result === 'error') {
    return () => options.defaultValue;
  }

  return (context: StylePropertyContext): T => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const value = result.value.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

    return (value ?? options.defaultValue) as T;
  };
}

export interface CreateExpressionEvaluatorOptions<T> {
  expression: unknown;
  defaultValue: T;
}

export function createExpressionEvaluator<T = unknown>(
  options: CreateExpressionEvaluatorOptions<T>,
): (context: StylePropertyContext) => T {
  const result = createPropertyExpression(
    options.expression,
    { type: 'string' } as any,
  );

  if (result.result === 'error') {
    return () => options.defaultValue;
  }

  return (context: StylePropertyContext): T => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const value = result.value.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

    return (value ?? options.defaultValue) as T;
  };
}

export function evaluatePropertyExpression(
  expression: StylePropertyExpression,
  context: StylePropertyContext,
): unknown {
  const globals: GlobalProperties = {
    zoom: context.zoom,
  };

  return expression.evaluate(
    globals,
    context.feature,
    context.featureState,
    context.canonical,
  );
}
