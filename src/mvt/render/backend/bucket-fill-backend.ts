import type {
  FillLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {
  Bucket,
  FillBucketData,
  FillBucketStats,
  ParsedTileResult,
} from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import { BufferPolygon, BufferPolygonCollection } from 'cesium';
import { createFeatureFilter } from '../../style/feature-filter';
import { isValidTypedArray, validatePositions } from '../../utils/validation';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { getFillMaterial } from './material-cache';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';

export interface BucketFillCollectionHandle {
  byteLength: number;
  collection: BufferPolygonCollection;
  layerId: string;
  polygonCount: number;
}

export interface BucketFillTileHandle {
  byteLength: number;
  collections: BucketFillCollectionHandle[];
  key: string;
}

export interface CreateBucketFillTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  style: StyleSpecification;
}

interface PolygonSlice {
  featureId: number | undefined;
  holes: Uint32Array;
  positions: Float64Array;
  triangles: Uint32Array;
}

export function createBucketFillTileHandle({
  bucketTile,
  featureStateResolver,
  style,
}: CreateBucketFillTileHandleOptions): BucketFillTileHandle | undefined {
  const fillBuckets = bucketTile.buckets.filter(isFillBucket);
  if (fillBuckets.length === 0) {
    return undefined;
  }

  const { level: zoom, sourceId } = parseRenderTileCoordinateFromKey(bucketTile.key);
  const layersById = new Map(
    style.layers.filter(isFillLayer).map(layer => [layer.id, layer]),
  );
  const collections: BucketFillCollectionHandle[] = [];

  for (const bucket of fillBuckets) {
    const stats = bucket.stats as FillBucketStats;
    const data = bucket.data as FillBucketData;

    if (stats.vertexCount === 0 || data.positions.length === 0) {
      continue;
    }

    if (!validateFillBucketData(data)) {
      continue;
    }

    if (!validatePositions(data.positions)) {
      continue;
    }

    // 每个 layer 仍然保留自己的 filter 和 paint 语义，避免 family 只剩下几何分组。
    for (const layerId of bucket.layerIds) {
      const layer = layersById.get(layerId);
      if (!layer) {
        continue;
      }

      const filter = createFeatureFilter(layer.filter);
      const collection = new BufferPolygonCollection({
        holeCountMax: Math.min(stats.holeCount || 0, 10000000),
        primitiveCountMax: Math.min(stats.polygonCount || 1, 10000000),
        triangleCountMax: Math.min(stats.triangleCount || 0, 10000000),
        vertexCountMax: Math.min(stats.vertexCount || 0, 10000000),
      });
      const flyweight = new BufferPolygon();
      let polygonCount = 0;

      for (const polygon of iterateFillPolygons(data)) {
        const featureIndex = getFeatureIndexEntry(
          bucket.featureIndex.entries,
          polygon.featureId,
        );
        const featureState = featureStateResolver?.({
          id: featureIndex?.id,
          sourceId,
          sourceLayer: bucket.sourceLayer,
        });
        const context = createPrimitiveStyleContext(featureIndex, {
          featureState,
          geometryType: 'Polygon',
          zoom,
        });

        if (!filter(context)) {
          continue;
        }

        const material = getFillMaterial(style, layer, context);
        collection.add(
          {
            holes: polygon.holes,
            material,
            positions: polygon.positions,
            triangles: polygon.triangles,
          },
          flyweight,
        );
        flyweight.featureId = featureIndex?.id ?? 0;
        polygonCount += 1;
      }

      if (polygonCount === 0) {
        continue;
      }

      collections.push({
        byteLength: collection.byteLength,
        collection,
        layerId,
        polygonCount,
      });
    }
  }

  if (collections.length === 0) {
    return undefined;
  }

  return {
    byteLength: collections.reduce(
      (total, entry) => total + entry.byteLength,
      0,
    ),
    collections,
    key: bucketTile.key,
  };
}

function validateFillBucketData(data: FillBucketData): boolean {
  if (!isValidTypedArray(data.positions, Float64Array)) {
    return false;
  }
  if (!isValidTypedArray(data.triangles, Uint32Array)) {
    return false;
  }
  if (!isValidTypedArray(data.holes, Uint32Array)) {
    return false;
  }
  if (!isValidTypedArray(data.featureIds, Float32Array)) {
    return false;
  }

  if (
    data.polygonVertexCounts
    || data.polygonTriangleCounts
    || data.polygonHoleCounts
  ) {
    if (
      !data.polygonVertexCounts
      || !data.polygonTriangleCounts
      || !data.polygonHoleCounts
    ) {
      return false;
    }

    if (
      data.polygonVertexCounts.length !== data.polygonTriangleCounts.length
      || data.polygonVertexCounts.length !== data.polygonHoleCounts.length
    ) {
      return false;
    }
  }

  return true;
}

function* iterateFillPolygons(data: FillBucketData): Generator<PolygonSlice> {
  if (
    data.polygonVertexCounts
    && data.polygonTriangleCounts
    && data.polygonHoleCounts
  ) {
    let vertexOffset = 0;
    let triangleOffset = 0;
    let holeOffset = 0;

    for (let index = 0; index < data.polygonVertexCounts.length; index += 1) {
      const vertexCount = data.polygonVertexCounts[index]!;
      const triangleCount = data.polygonTriangleCounts[index]!;
      const holeCount = data.polygonHoleCounts[index]!;
      const featureId = data.featureIds[vertexOffset];

      yield {
        featureId,
        holes: data.holes.subarray(holeOffset, holeOffset + holeCount),
        positions: data.positions.subarray(
          vertexOffset * 3,
          (vertexOffset + vertexCount) * 3,
        ),
        triangles: rebaseTriangles(
          data.triangles.subarray(
            triangleOffset * 3,
            (triangleOffset + triangleCount) * 3,
          ),
          vertexOffset,
        ),
      };

      vertexOffset += vertexCount;
      triangleOffset += triangleCount;
      holeOffset += holeCount;
    }

    return;
  }

  let vertexOffset = 0;
  let triangleOffset = 0;
  let holeOffset = 0;

  while (vertexOffset < data.featureIds.length) {
    const featureId = data.featureIds[vertexOffset];
    let nextVertexOffset = vertexOffset + 1;
    while (
      nextVertexOffset < data.featureIds.length
      && data.featureIds[nextVertexOffset] === featureId
    ) {
      nextVertexOffset += 1;
    }

    let nextTriangleOffset = triangleOffset;
    while (nextTriangleOffset * 3 < data.triangles.length) {
      const triangleStart = nextTriangleOffset * 3;
      const triangleIndex = data.triangles[triangleStart];
      if (triangleIndex === undefined || triangleIndex >= nextVertexOffset) {
        break;
      }
      nextTriangleOffset += 1;
    }

    const vertexCount = nextVertexOffset - vertexOffset;
    const triangleCount = nextTriangleOffset - triangleOffset;
    const holeCount = Math.max(
      0,
      Math.round((triangleCount - vertexCount + 2) / 2),
    );

    yield {
      featureId,
      holes: data.holes.subarray(holeOffset, holeOffset + holeCount),
      positions: data.positions.subarray(
        vertexOffset * 3,
        nextVertexOffset * 3,
      ),
      triangles: rebaseTriangles(
        data.triangles.subarray(
          triangleOffset * 3,
          nextTriangleOffset * 3,
        ),
        vertexOffset,
      ),
    };

    vertexOffset = nextVertexOffset;
    triangleOffset = nextTriangleOffset;
    holeOffset += holeCount;
  }
}

function rebaseTriangles(triangles: Uint32Array, baseIndex: number): Uint32Array {
  const rebasedTriangles = new Uint32Array(triangles.length);
  for (let index = 0; index < triangles.length; index += 1) {
    rebasedTriangles[index] = triangles[index]! - baseIndex;
  }
  return rebasedTriangles;
}

function isFillBucket(
  bucket: Bucket,
): bucket is Bucket & { data: FillBucketData } {
  return bucket.type === 'fill';
}

function isFillLayer(
  layer: StyleSpecification['layers'][number],
): layer is FillLayerSpecification {
  return layer.type === 'fill';
}
