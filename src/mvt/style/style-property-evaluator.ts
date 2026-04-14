import type { Feature, FeatureState, GlobalProperties, ICanonicalTileID, StyleExpression, StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  Color,
  Formatted,
  normalizePropertyExpression,

  ResolvedImage,

} from '@maplibre/maplibre-gl-style-spec';

export type {
  Color,
  Feature,
  FeatureState,
  GlobalProperties,
  ICanonicalTileID,
  StyleExpression,
};

export interface StylePropertyContext {
  zoom: number;
  feature?: Feature;
  featureState?: FeatureState;
  canonical?: ICanonicalTileID;
}

export interface StylePropertyEvaluator<T = unknown> {
  (context: StylePropertyContext): T;
  isConstant?: boolean;
}

function colorToHex(color: Color): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

const COLOR_SPEC: StylePropertySpecification = {
  'type': 'color',
  'property-type': 'data-driven',
  'expression': {
    interpolated: true,
    parameters: ['zoom', 'feature', 'feature-state'],
  },
  'transition': true,
  'default': '#000000',
  'overridable': true,
} as StylePropertySpecification;

const NUMBER_SPEC: StylePropertySpecification = {
  'type': 'number',
  'property-type': 'data-driven',
  'expression': {
    interpolated: true,
    parameters: ['zoom', 'feature', 'feature-state'],
  },
  'transition': true,
  'default': 0,
} as StylePropertySpecification;

const NUMBER_ARRAY_SPEC: StylePropertySpecification = {
  'type': 'array',
  'value': 'number',
  'property-type': 'data-driven',
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature'],
  },
  'transition': true,
  'default': [],
} as StylePropertySpecification;

const STRING_SPEC: StylePropertySpecification = {
  'type': 'string',
  'property-type': 'data-driven',
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature', 'feature-state'],
  },
  'transition': false,
  'default': '',
} as StylePropertySpecification;

const BOOLEAN_SPEC: StylePropertySpecification = {
  'type': 'boolean',
  'property-type': 'data-driven',
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature', 'feature-state'],
  },
  'transition': false,
  'default': false,
} as StylePropertySpecification;

const FORMATTED_SPEC: StylePropertySpecification = {
  'default': '',
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature'],
  },
  'property-type': 'data-driven',
  'transition': false,
  'type': 'formatted',
} as unknown as StylePropertySpecification;

const RESOLVED_IMAGE_SPEC: StylePropertySpecification = {
  'default': '',
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature'],
  },
  'property-type': 'data-driven',
  'transition': false,
  'type': 'resolvedImage',
} as unknown as StylePropertySpecification;

const STRING_ARRAY_SPEC: StylePropertySpecification = {
  'default': [],
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature'],
  },
  'property-type': 'data-driven',
  'transition': false,
  'type': 'array',
  'value': 'string',
} as StylePropertySpecification;

interface StyleExpressionLike {
  evaluate: (...args: unknown[]) => unknown;
  evaluateWithoutErrorHandling?: (...args: unknown[]) => unknown;
}

function evaluateStyleExpression(
  expression: unknown,
  context: StylePropertyContext,
): unknown {
  const globals: GlobalProperties = {
    zoom: context.zoom,
  };
  const styleExpression = expression as StyleExpressionLike;

  try {
    if (typeof styleExpression.evaluateWithoutErrorHandling === 'function') {
      return styleExpression.evaluateWithoutErrorHandling(
        globals,
        context.feature,
        context.featureState,
        context.canonical,
      );
    }

    return styleExpression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );
  }
  catch {
    return undefined;
  }
}

export function createColorPropertyEvaluator(
  value: unknown,
  defaultValue?: string,
): StylePropertyEvaluator<string> {
  const expression = normalizePropertyExpression(value as any, COLOR_SPEC);

  return (context: StylePropertyContext): string => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (evaluated === null || evaluated === undefined) {
      return defaultValue ?? '#000000';
    }

    if (typeof evaluated === 'string') {
      return evaluated;
    }

    if (evaluated instanceof Color) {
      return colorToHex(evaluated);
    }

    return defaultValue ?? '#000000';
  };
}

export function createNumberPropertyEvaluator(
  value: unknown,
  defaultValue?: number,
): StylePropertyEvaluator<number> {
  const expression = normalizePropertyExpression(value as any, NUMBER_SPEC);
  const evaluator: StylePropertyEvaluator<number> = (context: StylePropertyContext): number => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (typeof evaluated === 'number') {
      return evaluated;
    }

    return defaultValue ?? 0;
  };
  evaluator.isConstant = expression.kind === 'constant';
  return evaluator;
}

export function createNumberArrayPropertyEvaluator(
  value: unknown,
  defaultValue?: number[],
  options?: {
    allowNegative?: boolean;
  },
): StylePropertyEvaluator<number[] | undefined> {
  const expression = normalizePropertyExpression(value as any, NUMBER_ARRAY_SPEC);
  const allowNegative = options?.allowNegative ?? false;

  return (context: StylePropertyContext): number[] | undefined => {
    const evaluated = evaluateStyleExpression(expression, context);

    const normalized = normalizeNumberArrayValue(evaluated, allowNegative);
    if (normalized) {
      return normalized;
    }

    return defaultValue ? [...defaultValue] : undefined;
  };
}

export function createBooleanPropertyEvaluator(
  value: unknown,
  defaultValue?: boolean,
): StylePropertyEvaluator<boolean> {
  const expression = normalizePropertyExpression(value as any, BOOLEAN_SPEC);

  return (context: StylePropertyContext): boolean => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (typeof evaluated === 'boolean') {
      return evaluated;
    }

    return defaultValue ?? false;
  };
}

function normalizeNumberArrayValue(
  value: unknown,
  allowNegative = false,
): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || (!allowNegative && entry < 0)) {
      return undefined;
    }
    numbers.push(entry);
  }

  return numbers;
}

export function createStringPropertyEvaluator(
  value: unknown,
  defaultValue?: string,
): StylePropertyEvaluator<string> {
  const expression = normalizePropertyExpression(value as any, STRING_SPEC);

  return (context: StylePropertyContext): string => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (typeof evaluated === 'string') {
      return evaluated;
    }

    return defaultValue ?? '';
  };
}

export function createFormattedPropertyEvaluator(
  value: unknown,
): StylePropertyEvaluator<string | Formatted | undefined> {
  const expression = normalizePropertyExpression(value as any, FORMATTED_SPEC);

  return (context: StylePropertyContext): string | Formatted | undefined => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (typeof evaluated === 'string') {
      return evaluated.length > 0 ? evaluated : undefined;
    }

    if (evaluated instanceof Formatted) {
      return evaluated.toString().length > 0 ? evaluated : undefined;
    }

    return undefined;
  };
}

export function createResolvedImagePropertyEvaluator(
  value: unknown,
): StylePropertyEvaluator<string | ResolvedImage | undefined> {
  const expression = normalizePropertyExpression(value as any, RESOLVED_IMAGE_SPEC);

  return (context: StylePropertyContext): string | ResolvedImage | undefined => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (typeof evaluated === 'string') {
      return evaluated.length > 0 ? evaluated : undefined;
    }

    if (evaluated instanceof ResolvedImage) {
      return evaluated.name.length > 0 ? evaluated : undefined;
    }

    return undefined;
  };
}

export function createStringArrayPropertyEvaluator(
  value: unknown,
): StylePropertyEvaluator<string[] | undefined> {
  const expression = normalizePropertyExpression(value as any, STRING_ARRAY_SPEC);

  return (context: StylePropertyContext): string[] | undefined => {
    const evaluated = evaluateStyleExpression(expression, context);

    if (Array.isArray(evaluated)) {
      const entries: string[] = [];
      for (const entry of evaluated) {
        if (typeof entry !== 'string') {
          return undefined;
        }
        entries.push(entry);
      }
      return entries.length > 0 ? entries : undefined;
    }

    if (typeof evaluated === 'string' && evaluated.length > 0) {
      return [evaluated];
    }

    return undefined;
  };
}
