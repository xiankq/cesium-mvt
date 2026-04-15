import type {
  Feature,
  FeatureState,
  FilterSpecification,
  GlobalProperties,
  ICanonicalTileID,
  StylePropertySpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { convertFilter, createExpression } from '@maplibre/maplibre-gl-style-spec';

export type {
  Feature,
  FeatureState,
  FilterSpecification,
  GlobalProperties,
  ICanonicalTileID,
};

const FILTER_SPEC: StylePropertySpecification = {
  'default': false,
  'expression': {
    interpolated: false,
    parameters: ['zoom', 'feature', 'feature-state'],
  },
  'property-type': 'data-driven',
  'transition': false,
  'type': 'boolean',
} as StylePropertySpecification;

const SHARED_FILTER_CACHE_MAX_SIZE = 512;
const sharedFeatureFilterCache = new Map<
  string,
  (context: FeatureFilterContext) => boolean
>();

export interface FeatureFilterContext {
  feature?: Feature;
  featureState?: FeatureState;
  zoom: number;
  geometryType?: string;
  id?: Feature['id'];
  properties?: Feature['properties'];
  canonical?: ICanonicalTileID;
}

export function createFeatureFilter(
  filterSpec: FilterSpecification | null | undefined,
): (context: FeatureFilterContext) => boolean {
  if (filterSpec === null || filterSpec === undefined) {
    return () => true;
  }

  if (filterSpec === true) {
    return () => true;
  }

  if (filterSpec === false) {
    return () => false;
  }

  const normalizedFilter = normalizeFilterSpec(filterSpec);
  const key = JSON.stringify(normalizedFilter);
  const cached = sharedFeatureFilterCache.get(key);
  if (cached) {
    return cached;
  }

  const filter = createExpression(
    convertFilter(normalizedFilter),
    FILTER_SPEC,
  );
  if (filter.result === 'error') {
    throw new Error(filter.value.map(err => `${err.key}: ${err.message}`).join(', '));
  }

  const compiled = (context: FeatureFilterContext): boolean => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };
    const feature = context.feature ?? ({
      id: context.id,
      properties: context.properties ?? {},
      type: context.geometryType ?? 'Unknown',
    } as Feature);

    try {
      return Boolean(filter.value.evaluateWithoutErrorHandling(
        globals,
        feature,
        context.featureState,
        context.canonical,
      ));
    }
    catch {
      return false;
    }
  };

  if (sharedFeatureFilterCache.size >= SHARED_FILTER_CACHE_MAX_SIZE) {
    const firstKey = sharedFeatureFilterCache.keys().next().value;
    if (firstKey !== undefined) {
      sharedFeatureFilterCache.delete(firstKey);
    }
  }

  sharedFeatureFilterCache.set(key, compiled);
  return compiled;
}

function normalizeFilterSpec(
  filterSpec: FilterSpecification,
): FilterSpecification {
  if (filterSpec === true || filterSpec === false) {
    return filterSpec;
  }

  if (!Array.isArray(filterSpec) || filterSpec.length === 0) {
    return filterSpec;
  }

  const [operator, ...args] = filterSpec;
  switch (operator) {
    case 'all':
      if (args.length === 0) {
        return true;
      }
      return [operator, ...args.map(arg => normalizeFilterSpec(arg as FilterSpecification))] as FilterSpecification;
    case 'any':
      if (args.length === 0) {
        return false;
      }
      return [operator, ...args.map(arg => normalizeFilterSpec(arg as FilterSpecification))] as FilterSpecification;
    case '!':
      return ['!', normalizeFilterSpec(args[0] as FilterSpecification)] as FilterSpecification;
    case 'none':
      if (args.length === 0) {
        return true;
      }
      return ['!', ['any', ...args.map(arg => normalizeFilterSpec(arg as FilterSpecification))]] as FilterSpecification;
    case 'in':
      if (args.length <= 1) {
        return false;
      }
      return convertInExpression(args);
    case '!in':
      if (args.length <= 1) {
        return true;
      }
      return ['!', convertInExpression(args)] as FilterSpecification;
    default:
      return filterSpec;
  }
}

function convertInExpression(args: unknown[]): FilterSpecification {
  const [valueExpression, ...values] = args;
  const normalizedValueExpression = normalizeValueExpression(valueExpression);

  return [
    'any',
    ...values.map(value => ['==', normalizedValueExpression, value] as FilterSpecification),
  ] as FilterSpecification;
}

function normalizeValueExpression(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === '$type') {
    return ['geometry-type'];
  }

  if (value === '$id') {
    return ['id'];
  }

  if (typeof value === 'string') {
    return ['get', value];
  }

  // 数字、布尔值和 null 作为字面量保留，避免被误判成属性名。
  return ['literal', value];
}
