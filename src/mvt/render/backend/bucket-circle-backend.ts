import type {
  CircleLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {
  Bucket,
  CircleBucketData,
  CircleBucketStats,
  ParsedTileResult,
} from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import { BufferPoint, BufferPointCollection, Cartesian3 } from 'cesium';
import { createFeatureFilter } from '../../style/filter-adapter';
import { isValidTypedArray } from '../../utils/validation';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { getCircleMaterial } from './material-cache';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';

export interface BucketCircleCollectionHandle {
  byteLength: number;
  collection: BufferPointCollection;
  layerId: string;
  pointCount: number;
}

export interface BucketCircleTileHandle {
  byteLength: number;
  collections: BucketCircleCollectionHandle[];
  key: string;
}

export interface CreateBucketCircleTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  style: StyleSpecification;
}

export function createBucketCircleTileHandle({
  bucketTile,
  featureStateResolver,
  style,
}: CreateBucketCircleTileHandleOptions): BucketCircleTileHandle | undefined {
  const circleBuckets = bucketTile.buckets.filter(isCircleBucket);
  if (circleBuckets.length === 0) {
    return undefined;
  }

  const { level: zoom, sourceId } = parseRenderTileCoordinateFromKey(bucketTile.key);
  const layersById = new Map(
    style.layers.filter(isCircleLayer).map(layer => [layer.id, layer]),
  );

  const collections: BucketCircleCollectionHandle[] = [];

  for (const bucket of circleBuckets) {
    for (const layerId of bucket.layerIds) {
      const collectionHandle = createCircleCollection(
        bucket,
        layerId,
        layersById,
        featureStateResolver,
        style,
        sourceId,
        zoom,
      );
      if (collectionHandle) {
        collections.push(collectionHandle);
      }
    }
  }

  if (collections.length === 0) {
    return undefined;
  }

  const byteLength = collections.reduce(
    (total, c) => total + c.byteLength,
    0,
  );

  return {
    byteLength,
    collections,
    key: bucketTile.key,
  };
}

function createCircleCollection(
  bucket: Bucket,
  layerId: string,
  layersById: Map<string, CircleLayerSpecification>,
  featureStateResolver: FeatureStateResolver | undefined,
  style: StyleSpecification,
  sourceId: string,
  zoom: number,
): BucketCircleCollectionHandle | undefined {
  const data = bucket.data as CircleBucketData;
  const stats = bucket.stats as CircleBucketStats;

  if (stats.pointCount === 0 || data.positions.length === 0) {
    return undefined;
  }

  if (!validateCircleBucketData(data)) {
    return undefined;
  }

  const layer = layersById.get(layerId);
  if (!layer) {
    return undefined;
  }

  const filter = createFeatureFilter(layer.filter);
  const primitiveCountMax = Math.min(stats.pointCount || 0, 10000000);

  if (primitiveCountMax === 0) {
    return undefined;
  }

  const collection = new BufferPointCollection({
    primitiveCountMax,
  });

  const flyweight = new BufferPoint();
  let pointCount = 0;

  for (let index = 0; index < stats.pointCount; index += 1) {
    const x = data.positions[index * 3];
    const y = data.positions[index * 3 + 1];
    const z = data.positions[index * 3 + 2];

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const featureId = data.featureIds[index];
    const featureIndex = getFeatureIndexEntry(
      bucket.featureIndex.entries,
      featureId,
    );
    const featureState = featureStateResolver?.({
      id: featureIndex?.id,
      sourceId,
      sourceLayer: bucket.sourceLayer,
    });
    const context = createPrimitiveStyleContext(featureIndex, {
      featureState,
      geometryType: 'Point',
      zoom,
    });

    if (context.feature && !filter(context)) {
      continue;
    }

    const material = getCircleMaterial(style, layer, context);

    collection.add(
      {
        material,
        position: new Cartesian3(x, y, z),
      },
      flyweight,
    );
    flyweight.featureId = featureIndex?.id ?? 0;
    pointCount += 1;
  }

  return {
    byteLength: data.positions.byteLength + data.featureIds.byteLength,
    collection,
    layerId,
    pointCount,
  };
}

function validateCircleBucketData(data: CircleBucketData): boolean {
  if (!isValidTypedArray(data.positions, Float64Array)) {
    return false;
  }
  if (!isValidTypedArray(data.featureIds, Float32Array)) {
    return false;
  }
  return true;
}

function isCircleBucket(
  bucket: Bucket,
): bucket is Bucket & { data: CircleBucketData; stats: CircleBucketStats } {
  return bucket.type === 'circle';
}

function isCircleLayer(
  layer: StyleSpecification['layers'][number],
): layer is CircleLayerSpecification {
  return layer.type === 'circle';
}
