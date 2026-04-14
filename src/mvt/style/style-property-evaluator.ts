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
}

function colorToHex(color: Color): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function normalizeColorValue(value: unknown): unknown {
  if (value instanceof Color) {
    return colorToHex(value);
  }
  return value;
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

function inferSpecification(value: unknown): StylePropertySpecification {
  if (typeof value === 'number') {
    return NUMBER_SPEC;
  }

  if (typeof value === 'boolean') {
    return BOOLEAN_SPEC;
  }

  if (typeof value === 'string') {
    if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) {
      return COLOR_SPEC;
    }
    return STRING_SPEC;
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === 'string') {
      if (first === 'interpolate' || first === 'step') {
        return NUMBER_SPEC;
      }
    }
  }

  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;

    if ('stops' in obj) {
      const stops = obj.stops;
      if (Array.isArray(stops) && stops.length > 0) {
        const firstStop = stops[0];
        if (Array.isArray(firstStop) && firstStop.length === 2) {
          const stopValue = firstStop[1];
          if (typeof stopValue === 'number') {
            return NUMBER_SPEC;
          }
          if (typeof stopValue === 'string') {
            if (stopValue.startsWith('#') || stopValue.startsWith('rgb') || stopValue.startsWith('hsl')) {
              return COLOR_SPEC;
            }
            return STRING_SPEC;
          }
        }
      }
    }
  }

  return COLOR_SPEC;
}

export function createStylePropertyEvaluator<T = unknown>(
  value: unknown,
  defaultValue?: T,
  specification?: StylePropertySpecification,
): StylePropertyEvaluator<T> {
  const spec = specification ?? inferSpecification(value);
  const expression = normalizePropertyExpression(value as any, spec);

  return (context: StylePropertyContext): T => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

    const normalized = normalizeColorValue(evaluated);
    return (normalized ?? defaultValue) as T;
  };
}

export function createColorPropertyEvaluator(
  value: unknown,
  defaultValue?: string,
): StylePropertyEvaluator<string> {
  const expression = normalizePropertyExpression(value as any, COLOR_SPEC);

  return (context: StylePropertyContext): string => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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

  return (context: StylePropertyContext): number => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

    if (typeof evaluated === 'number') {
      return evaluated;
    }

    return defaultValue ?? 0;
  };
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
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    const evaluated = expression.evaluate(
      globals,
      context.feature,
      context.featureState,
      context.canonical,
    );

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
