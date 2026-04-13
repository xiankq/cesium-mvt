import type {
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {
  Bucket,
  LineBucketData,
  LineBucketStats,
  ParsedTileResult,
} from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import { BufferPolyline, BufferPolylineCollection } from 'cesium';
import { createFeatureFilter } from '../../style/feature-filter';
import { validatePositions } from '../../utils/validation';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { getLineMaterial } from './material-cache';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';

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
  featureStateResolver?: FeatureStateResolver;
  style: StyleSpecification;
}

export function createBucketLineTileHandle({
  bucketTile,
  featureStateResolver,
  style,
}: CreateBucketLineTileHandleOptions): BucketLineTileHandle | undefined {
  const lineBuckets = bucketTile.buckets.filter(isLineBucket);
  if (lineBuckets.length === 0) {
    return undefined;
  }

  const { level: zoom, sourceId } = parseRenderTileCoordinateFromKey(bucketTile.key);
  const layersById = new Map(
    style.layers.filter(isLineLayer).map(layer => [layer.id, layer]),
  );

  const collections: BucketLineCollectionHandle[] = [];

  for (const bucket of lineBuckets) {
    for (const layerId of bucket.layerIds) {
      const collectionHandle = createLineCollection(
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

function createLineCollection(
  bucket: Bucket,
  layerId: string,
  layersById: Map<string, LineLayerSpecification>,
  featureStateResolver: FeatureStateResolver | undefined,
  style: StyleSpecification,
  sourceId: string,
  zoom: number,
): BucketLineCollectionHandle | undefined {
  const data = bucket.data as LineBucketData;
  const stats = bucket.stats as LineBucketStats;

  if (stats.polylineCount === 0 || data.positions.length === 0) {
    return undefined;
  }

  if (!validateLineBucketData(data)) {
    return undefined;
  }

  const layer = layersById.get(layerId);
  if (!layer) {
    return undefined;
  }

  const filter = createFeatureFilter(layer.filter);
  const primitiveCountMax = Math.min(stats.polylineCount || 0, 10000000);
  const vertexCountMax = Math.min(stats.totalVertexCount || 0, 10000000);

  if (primitiveCountMax === 0 || vertexCountMax === 0) {
    return undefined;
  }

  const collection = new BufferPolylineCollection({
    primitiveCountMax,
    vertexCountMax,
  });

  const flyweight = new BufferPolyline();
  const vertexCounts = Array.from(data.vertexCounts);
  let vertexOffset = 0;
  let polylineCount = 0;

  for (let index = 0; index < vertexCounts.length; index += 1) {
    const vertexCount = vertexCounts[index]!;
    if (vertexCount < 2) {
      vertexOffset += vertexCount;
      continue;
    }

    const featureId = data.featureIds[vertexOffset];
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
      geometryType: 'LineString',
      zoom,
    });

    if (!filter(context)) {
      vertexOffset += vertexCount;
      continue;
    }

    const positions = extractPositions(
      data.positions,
      vertexOffset,
      vertexCount,
    );
    if (!validatePositions(positions)) {
      vertexOffset += vertexCount;
      continue;
    }

    const material = getLineMaterial(style, layer, context);

    collection.add(
      {
        material,
        positions,
      },
      flyweight,
    );
    flyweight.featureId = featureIndex?.id ?? 0;

    vertexOffset += vertexCount;
    polylineCount += 1;
  }

  return {
    byteLength:
      data.positions.byteLength
      + data.vertexCounts.byteLength
      + data.featureIds.byteLength,
    collection,
    layerId,
    polylineCount,
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

function isLineBucket(
  bucket: Bucket,
): bucket is Bucket & { data: LineBucketData; stats: LineBucketStats } {
  return bucket.type === 'line';
}

function isLineLayer(
  layer: StyleSpecification['layers'][number],
): layer is LineLayerSpecification {
  return layer.type === 'line';
}
