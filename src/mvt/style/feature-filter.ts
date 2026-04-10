import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

export type FeatureMatchesPredicate = (feature: VectorTileFeature) => boolean;

// MapLibre 的 filter 语义需要在几何进入 bucket 之前就先裁掉不匹配的 feature，
// 这样 family、bucket 和 feature 提取三层才能共享同一套选择条件。
export function createFeatureMatchesPredicate(
  filter?: FilterSpecification,
  zoom = 0,
): FeatureMatchesPredicate {
  const compiledFilter = featureFilter(filter);
  const globalProperties = { zoom };
  return feature => compiledFilter.filter(globalProperties, feature);
}
