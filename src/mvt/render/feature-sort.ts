import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer } from '../types';

const sortKeyPropertyByType = {
  circle: 'circle-sort-key',
  fill: 'fill-sort-key',
  line: 'line-sort-key',
  symbol: 'symbol-sort-key',
} as const;

export function sortBucketFeaturesForLayer(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  features: readonly BucketFeature[],
): readonly BucketFeature[] {
  if (layer.type === 'background') {
    return features;
  }

  const sortKeyProperty = sortKeyPropertyByType[layer.type];
  if (layer.layout[sortKeyProperty] === undefined) {
    return features;
  }

  return [...features]
    .map((feature, index) => ({
      feature,
      index,
      sortKey: styleSet.evaluateLayoutNumber(layer, sortKeyProperty, zoom, feature, 0),
    }))
    .sort((left, right) => {
      if (left.sortKey !== right.sortKey) {
        return left.sortKey - right.sortKey;
      }

      return left.index - right.index;
    })
    .map(item => item.feature);
}
