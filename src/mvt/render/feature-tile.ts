import type Point from '@mapbox/point-geometry';
import type { ParsedTile } from '../source/vector-tile';
import type { BackgroundBatch, GeometryBatch, RenderTile } from './render-tile';
import { getSourceLayer } from '../source/vector-tile';

export interface ExtractedFeature {
  geometry: Point[][];
  id: number | undefined;
  properties: Record<string, number | string | boolean>;
  type: 'line' | 'point' | 'polygon';
}

export interface FeatureBatch extends GeometryBatch {
  extent: number;
  featureCount: number;
  features: ExtractedFeature[];
}

export interface FeatureTile {
  background?: BackgroundBatch;
  epoch: number;
  geometryBatches: FeatureBatch[];
  key: string;
}

export interface CompileFeatureTileOptions {
  renderTile: RenderTile;
  tile: ParsedTile;
}

export function compileFeatureTile(
  options: CompileFeatureTileOptions,
): FeatureTile {
  return {
    background: options.renderTile.background,
    epoch: options.renderTile.epoch,
    geometryBatches: options.renderTile.geometryBatches.flatMap(
      batch => compileFeatureBatch(batch, options.tile),
    ),
    key: options.renderTile.key,
  };
}

function compileFeatureBatch(batch: GeometryBatch, tile: ParsedTile) {
  if (!batch.sourceLayer) {
    return [];
  }

  const sourceLayer = getSourceLayer(tile, batch.sourceLayer);
  if (!sourceLayer) {
    return [];
  }

  const features: ExtractedFeature[] = [];
  for (let index = 0; index < sourceLayer.length; index += 1) {
    const feature = sourceLayer.feature(index);
    const featureType = getFeatureType(feature.type);
    if (!featureType || !matchesBatchType(batch.type, featureType)) {
      continue;
    }

    features.push({
      geometry: feature.loadGeometry(),
      id: feature.id,
      properties: { ...feature.properties },
      type: featureType,
    });
  }

  if (features.length === 0) {
    return [];
  }

  return [{
    ...batch,
    extent: sourceLayer.extent,
    featureCount: features.length,
    features,
  }];
}

function getFeatureType(type: 0 | 1 | 2 | 3) {
  switch (type) {
    case 1:
      return 'point';
    case 2:
      return 'line';
    case 3:
      return 'polygon';
    default:
      return undefined;
  }
}

function matchesBatchType(
  batchType: GeometryBatch['type'],
  featureType: ExtractedFeature['type'],
) {
  return (batchType === 'circle' && featureType === 'point')
    || (batchType === 'line' && featureType === 'line')
    || (batchType === 'fill' && featureType === 'polygon');
}
