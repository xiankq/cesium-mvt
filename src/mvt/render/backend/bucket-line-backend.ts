import type {
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { WebMercatorTilingScheme } from 'cesium';
import type { Bucket, LineBucketData, LineBucketStats, ParsedTileResult } from '../../worker/bucket/bucket-types';
import {
  BufferPolyline,
  BufferPolylineCollection,
} from 'cesium';
import { getLineMaterial } from './material-cache';

export interface BucketLineCollectionHandle {
  byteLength: number;
  collection: BufferPolylineCollection;
  layerId: string;
  polylineCount: number;
}

export interface BucketLineTileHandle {
  byteLength: number;
  collections: BucketLineCollectionHandle[];
  key: string;
}

export interface CreateBucketLineTileHandleOptions {
  bucketTile: ParsedTileResult;
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

export function createBucketLineTileHandle({
  bucketTile,
  style,
}: CreateBucketLineTileHandleOptions): BucketLineTileHandle | undefined {
  const lineBuckets = bucketTile.buckets.filter(isLineBucket);
  if (lineBuckets.length === 0) {
    return undefined;
  }

  const layersById = new Map(
    style.layers
      .filter(isLineLayer)
      .map(layer => [layer.id, layer]),
  );

  const collections: BucketLineCollectionHandle[] = [];

  for (const bucket of lineBuckets) {
    const collectionHandle = createLineCollection(bucket, layersById, style);
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

function createLineCollection(
  bucket: Bucket,
  layersById: Map<string, LineLayerSpecification>,
  style: StyleSpecification,
): BucketLineCollectionHandle | undefined {
  const data = bucket.data as LineBucketData;
  const stats = bucket.stats as LineBucketStats;

  if (stats.polylineCount === 0 || data.positions.length === 0) {
    return undefined;
  }

  if (!validateLineBucketData(data)) {
    return undefined;
  }

  const layerId = bucket.layerIds[0];
  const layer = layersById.get(layerId);
  if (!layer) {
    return undefined;
  }

  const collection = new BufferPolylineCollection({
    primitiveCountMax: stats.polylineCount,
    vertexCountMax: stats.totalVertexCount,
  });

  const material = getLineMaterial(style, layer);
  const flyweight = new BufferPolyline();

  const vertexCounts = Array.from(data.vertexCounts);
  let vertexOffset = 0;

  for (let i = 0; i < vertexCounts.length; i++) {
    const vertexCount = vertexCounts[i];
    if (vertexCount < 2) {
      vertexOffset += vertexCount;
      continue;
    }

    const positions = extractPositions(data.positions, vertexOffset, vertexCount);
    if (!validatePositions(positions)) {
      vertexOffset += vertexCount;
      continue;
    }

    const featureId = data.featureIds[vertexOffset] ?? 0;

    collection.add({
      material,
      positions,
    }, flyweight);
    flyweight.featureId = featureId;

    vertexOffset += vertexCount;
  }

  return {
    byteLength: data.positions.byteLength + data.vertexCounts.byteLength + data.featureIds.byteLength,
    collection,
    layerId,
    polylineCount: stats.polylineCount,
  };
}

function validateLineBucketData(data: LineBucketData): boolean {
  if (!data.positions || !(data.positions instanceof Float64Array)) {
    return false;
  }
  if (!data.vertexCounts || !(data.vertexCounts instanceof Uint32Array)) {
    return false;
  }
  if (!data.featureIds || !(data.featureIds instanceof Float32Array)) {
    return false;
  }
  return true;
}

function validatePositions(positions: Float64Array): boolean {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      return false;
    }
  }
  return true;
}

function extractPositions(
  positions: Float64Array,
  offset: number,
  count: number,
): Float64Array {
  const start = offset * 3;
  const end = start + count * 3;
  if (end > positions.length) {
    return new Float64Array(0);
  }
  return positions.slice(start, end);
}

function isLineBucket(bucket: Bucket): bucket is Bucket & { data: LineBucketData; stats: LineBucketStats } {
  return bucket.type === 'line';
}

function isLineLayer(layer: any): layer is LineLayerSpecification {
  return layer.type === 'line';
}
