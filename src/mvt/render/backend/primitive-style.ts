import type { FeatureIndexEntry } from '../../bucket/bucket-types';
import type { Feature, StylePropertyContext } from '../../style/style-property-evaluator';

export type PrimitiveGeometryType = 'LineString' | 'Point' | 'Polygon';

export interface CreatePrimitiveStyleContextOptions {
  featureState?: Record<string, unknown>;
  geometryType: PrimitiveGeometryType;
  zoom: number;
}

export function createPrimitiveStyleContext(
  entry: FeatureIndexEntry | undefined,
  options: CreatePrimitiveStyleContextOptions,
): StylePropertyContext {
  const feature: Feature | undefined = entry
    ? {
        type: entry.type === 'point' ? 'Point' : entry.type === 'line' ? 'LineString' : 'Polygon',
        properties: entry.properties as Record<string, unknown>,
        id: entry.id,
      }
    : undefined;

  return {
    feature,
    featureState: options.featureState,
    zoom: options.zoom,
  };
}

export function getFeatureIndexEntry(
  entries: readonly FeatureIndexEntry[],
  featureId: number | undefined,
): FeatureIndexEntry | undefined {
  if (featureId === undefined || !Number.isFinite(featureId)) {
    return undefined;
  }

  return entries[Math.max(0, Math.trunc(featureId))];
}
