import type { Feature, FilterSpecification, GlobalProperties, ICanonicalTileID } from '@maplibre/maplibre-gl-style-spec';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

export type {
  Feature,
  FilterSpecification,
  GlobalProperties,
  ICanonicalTileID,
};

export interface FeatureFilterContext {
  zoom: number;
  feature: Feature;
  canonical?: ICanonicalTileID;
}

export interface FeatureFilterResult {
  filter: (globals: GlobalProperties, feature: Feature, canonical?: ICanonicalTileID) => boolean;
  needGeometry: boolean;
}

export function createFeatureFilter(
  filterSpec: FilterSpecification | null | undefined,
): (context: FeatureFilterContext) => boolean {
  if (filterSpec === null || filterSpec === undefined) {
    return () => true;
  }

  const filter = featureFilter(filterSpec);

  return (context: FeatureFilterContext): boolean => {
    const globals: GlobalProperties = {
      zoom: context.zoom,
    };

    return filter.filter(globals, context.feature, context.canonical);
  };
}

export function createFeatureFilterWithGeometry(
  filterSpec: FilterSpecification | null | undefined,
): FeatureFilterResult {
  if (filterSpec === null || filterSpec === undefined) {
    return {
      filter: () => true,
      needGeometry: false,
    };
  }

  const filter = featureFilter(filterSpec);

  return {
    filter: filter.filter,
    needGeometry: filter.needGeometry,
  };
}
