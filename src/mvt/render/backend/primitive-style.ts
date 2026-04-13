import type { FeatureIndexEntry } from '../../bucket/bucket-types';
import type { StylePropertyContext } from '../../style/style-property-evaluator';

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
  return {
    featureState: options.featureState,
    geometryType: options.geometryType,
    id: entry?.id,
    properties: entry?.properties ?? {},
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
