import type {
  CircleLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { WebMercatorTilingScheme } from 'cesium';
import type { Bucket, CircleBucketData, CircleBucketStats, ParsedTileResult } from '../../worker/bucket/bucket-types';
import {
  BufferPoint,
  BufferPointCollection,
  BufferPointMaterial,
  Cartesian3,
  Color,
} from 'cesium';

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
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

const DEFAULT_CIRCLE_COLOR = Color.BLACK;
const DEFAULT_CIRCLE_RADIUS = 5;

export function createBucketCircleTileHandle({
  bucketTile,
  style,
}: CreateBucketCircleTileHandleOptions): BucketCircleTileHandle | undefined {
  const circleBuckets = bucketTile.buckets.filter(isCircleBucket);
  if (circleBuckets.length === 0) {
    return undefined;
  }

  const layersById = new Map(
    style.layers
      .filter(isCircleLayer)
      .map(layer => [layer.id, layer]),
  );

  const collections: BucketCircleCollectionHandle[] = [];

  for (const bucket of circleBuckets) {
    const collectionHandle = createCircleCollection(bucket, layersById);
    if (collectionHandle) {
      collections.push(collectionHandle);
    }
  }

  if (collections.length === 0) {
    return undefined;
  }

  const byteLength = collections.reduce((total, c) => total + c.byteLength, 0);

  return {
    byteLength,
    collections,
    key: bucketTile.key,
  };
}

function createCircleCollection(
  bucket: Bucket,
  layersById: Map<string, CircleLayerSpecification>,
): BucketCircleCollectionHandle | undefined {
  const data = bucket.data as CircleBucketData;
  const stats = bucket.stats as CircleBucketStats;

  if (stats.pointCount === 0 || data.positions.length === 0) {
    return undefined;
  }

  if (!validateCircleBucketData(data)) {
    return undefined;
  }

  const layerId = bucket.layerIds[0];
  const layer = layersById.get(layerId);
  if (!layer) {
    return undefined;
  }

  const collection = new BufferPointCollection({
    primitiveCountMax: stats.pointCount,
  });

  const flyweight = new BufferPoint();
  const material = createCircleMaterial(layer);

  for (let i = 0; i < stats.pointCount; i++) {
    const x = data.positions[i * 3];
    const y = data.positions[i * 3 + 1];
    const z = data.positions[i * 3 + 2];

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const featureId = data.featureIds[i] ?? 0;

    collection.add({
      material,
      position: new Cartesian3(x, y, z),
    }, flyweight);
    flyweight.featureId = featureId;
  }

  return {
    byteLength: data.positions.byteLength + data.featureIds.byteLength,
    collection,
    layerId,
    pointCount: stats.pointCount,
  };
}

function validateCircleBucketData(data: CircleBucketData): boolean {
  if (!data.positions || !(data.positions instanceof Float64Array)) {
    return false;
  }
  if (!data.featureIds || !(data.featureIds instanceof Float32Array)) {
    return false;
  }
  return true;
}

function createCircleMaterial(layer: CircleLayerSpecification): BufferPointMaterial {
  const color = resolveCircleColor(layer);
  const radius = resolveCircleRadius(layer);
  // circle-radius表示半径，而BufferPoint的size语义是完整点精灵尺寸
  return new BufferPointMaterial({
    color,
    size: radius * 2,
  });
}

function resolveCircleColor(layer: CircleLayerSpecification): Color {
  const paint = layer.paint;
  if (!paint || !('circle-color' in paint)) {
    return DEFAULT_CIRCLE_COLOR;
  }

  const colorSpec = paint['circle-color'];
  if (typeof colorSpec === 'string') {
    return Color.fromCssColorString(colorSpec);
  }

  return DEFAULT_CIRCLE_COLOR;
}

function resolveCircleRadius(layer: CircleLayerSpecification): number {
  const paint = layer.paint;
  if (!paint || !('circle-radius' in paint)) {
    return DEFAULT_CIRCLE_RADIUS;
  }

  const radiusSpec = paint['circle-radius'];
  if (typeof radiusSpec === 'number') {
    return radiusSpec;
  }

  return DEFAULT_CIRCLE_RADIUS;
}

function isCircleBucket(bucket: Bucket): bucket is Bucket & { data: CircleBucketData; stats: CircleBucketStats } {
  return bucket.type === 'circle';
}

function isCircleLayer(layer: any): layer is CircleLayerSpecification {
  return layer.type === 'circle';
}
