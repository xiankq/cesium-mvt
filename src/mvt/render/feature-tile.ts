import type Point from '@mapbox/point-geometry';
import type { ParsedTile } from '../source/vector-tile';
import type { BackgroundBatch, GeometryBatch, RenderTile } from './render-tile';
import { getSourceLayer } from '../source/vector-tile';
import { createFeatureMatchesPredicate } from '../style/feature-filter';
import { parseRenderTileCoordinateFromKey } from './render-tile';

// FeatureTile 是各类渲染后端共享消费的几何提取结果。
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
  const { level } = parseRenderTileCoordinateFromKey(options.renderTile.key);
  return {
    background: options.renderTile.background,
    epoch: options.renderTile.epoch,
    geometryBatches: options.renderTile.geometryBatches.flatMap(
      batch => compileFeatureBatch(batch, options.tile, level),
    ),
    key: options.renderTile.key,
  };
}

function compileFeatureBatch(
  batch: GeometryBatch,
  tile: ParsedTile,
  zoom: number,
) {
  if (!batch.sourceLayer) {
    return [];
  }

  const sourceLayer = getSourceLayer(tile, batch.sourceLayer);
  if (!sourceLayer) {
    return [];
  }

  const featureMatches = createFeatureMatchesPredicate(batch.filter, zoom);
  const features: ExtractedFeature[] = [];
  for (let index = 0; index < sourceLayer.length; index += 1) {
    const feature = sourceLayer.feature(index);
    const featureType = getFeatureType(feature.type);
    // 这里只保留目标后端能够处理的几何类型。
    if (!featureType || !matchesBatchType(batch.type, featureType)) {
      continue;
    }

    if (!featureMatches(feature)) {
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
