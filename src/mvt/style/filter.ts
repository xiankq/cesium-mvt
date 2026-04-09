import type { Feature } from '@maplibre/maplibre-gl-style-spec';
import type { FilterEvaluator, FilterFeature, StyleFilterSpecification } from '../types';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

const alwaysMatchFilter: FilterEvaluator = () => true;

export function createFilterEvaluator(filter?: StyleFilterSpecification): FilterEvaluator {
  if (!filter) {
    return alwaysMatchFilter;
  }

  const compiledFilter = featureFilter(filter);
  return (feature, zoom = 0) => evaluateCompiledFilter(compiledFilter, feature, zoom);
}

function normalizeFilterFeature(feature: FilterFeature): Feature {
  return {
    id: feature.id,
    properties: feature.properties,
    type: feature.geometryType ?? 'Unknown',
  };
}

function evaluateCompiledFilter(
  compiledFilter: ReturnType<typeof featureFilter>,
  feature: FilterFeature,
  zoom: number,
): boolean {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') {
    return safelyRunCompiledFilter(compiledFilter, feature, zoom);
  }

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return safelyRunCompiledFilter(compiledFilter, feature, zoom);
  }
  finally {
    console.warn = originalWarn;
  }
}

function safelyRunCompiledFilter(
  compiledFilter: ReturnType<typeof featureFilter>,
  feature: FilterFeature,
  zoom: number,
): boolean {
  try {
    return compiledFilter.filter({ zoom }, normalizeFilterFeature(feature));
  }
  catch {
    return false;
  }
}
