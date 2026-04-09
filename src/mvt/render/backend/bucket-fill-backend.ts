import type {
  FillLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { WebMercatorTilingScheme } from 'cesium';
import type { Bucket, FillBucketData, FillBucketStats, ParsedTileResult } from '../../worker/bucket/bucket-types';
import {
  BufferPolygon,
  BufferPolygonCollection,
  BufferPolygonMaterial,
  Color,
} from 'cesium';

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
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

const DEFAULT_FILL_COLOR = Color.BLACK;

export function createBucketFillTileHandle({
  bucketTile,
  style,
}: CreateBucketFillTileHandleOptions): BucketFillTileHandle | undefined {
  const fillBuckets = bucketTile.buckets.filter(isFillBucket);
  if (fillBuckets.length === 0) {
    return undefined;
  }

  const layersById = new Map(
    style.layers
      .filter(isFillLayer)
      .map(layer => [layer.id, layer]),
  );
  const collections: BucketFillCollectionHandle[] = [];

  for (const bucket of fillBuckets) {
    const stats = bucket.stats as FillBucketStats;
    const data = bucket.data as FillBucketData;

    for (const layerId of bucket.layerIds) {
      const layer = layersById.get(layerId);
      if (!layer) {
        continue;
      }

      const collection = new BufferPolygonCollection({
        holeCountMax: stats.holeCount || 0,
        primitiveCountMax: stats.polygonCount || 0,
        triangleCountMax: stats.triangleCount || 0,
        vertexCountMax: stats.vertexCount || 0,
      });
      const flyweight = new BufferPolygon();
      const material = createFillMaterial(layer);

      const featureGroups = groupByFeature(data);

      for (const group of featureGroups) {
        collection.add({
          holes: group.holes,
          material,
          positions: group.positions,
          triangles: group.triangles,
        }, flyweight);
      }

      collections.push({
        byteLength: collection.byteLength,
        collection,
        layerId,
        polygonCount: stats.polygonCount || 0,
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

function isFillBucket(bucket: Bucket): bucket is Bucket & { data: FillBucketData } {
  return bucket.type === 'fill';
}

function isFillLayer(
  layer: StyleSpecification['layers'][number],
): layer is FillLayerSpecification {
  return layer.type === 'fill';
}

function createFillMaterial(layer: FillLayerSpecification) {
  const paint = layer.paint ?? {};
  const fillOpacity = resolveNumberPaintValue(paint['fill-opacity'], 1);
  const hasOutlineColor = typeof paint['fill-outline-color'] === 'string';

  return new BufferPolygonMaterial({
    color: applyOpacity(
      resolveColorPaintValue(
        paint['fill-color'],
        DEFAULT_FILL_COLOR,
      ),
      fillOpacity,
    ),
    outlineColor: applyOpacity(
      resolveColorPaintValue(
        paint['fill-outline-color'],
        DEFAULT_FILL_COLOR,
      ),
      fillOpacity,
    ),
    outlineWidth: hasOutlineColor ? 1 : 0,
  });
}

function resolveColorPaintValue(value: unknown, fallback: Color) {
  if (typeof value !== 'string') {
    return Color.clone(fallback);
  }

  return Color.fromCssColorString(value) ?? Color.clone(fallback);
}

function resolveNumberPaintValue(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : fallback;
}

function applyOpacity(color: Color, opacity: number) {
  const resolvedColor = Color.clone(color);
  resolvedColor.alpha *= clampOpacity(opacity);
  return resolvedColor;
}

function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}

interface FeatureGroup {
  holes: Uint32Array;
  positions: Float64Array;
  triangles: Uint32Array;
}

function groupByFeature(data: FillBucketData): FeatureGroup[] {
  const featureIds = data.featureIds;
  const positions = data.positions;
  const triangles = data.triangles;
  const holes = data.holes;

  const featureIdSet = new Set<number>();
  for (let i = 0; i < featureIds.length; i++) {
    featureIdSet.add(featureIds[i]);
  }

  const sortedFeatureIds = Array.from(featureIdSet).sort((a, b) => a - b);

  const groups: FeatureGroup[] = [];

  for (const featureId of sortedFeatureIds) {
    const vertexIndices: number[] = [];
    for (let i = 0; i < featureIds.length; i++) {
      if (featureIds[i] === featureId) {
        vertexIndices.push(i);
      }
    }

    const indexMap = new Map<number, number>();
    const newPositions: number[] = [];
    for (let i = 0; i < vertexIndices.length; i++) {
      const oldIndex = vertexIndices[i];
      indexMap.set(oldIndex, i);

      newPositions.push(
        positions[oldIndex * 3],
        positions[oldIndex * 3 + 1],
        positions[oldIndex * 3 + 2],
      );
    }

    const newTriangles: number[] = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const idx0 = triangles[i];
      const idx1 = triangles[i + 1];
      const idx2 = triangles[i + 2];

      if (featureIds[idx0] === featureId && featureIds[idx1] === featureId && featureIds[idx2] === featureId) {
        newTriangles.push(
          indexMap.get(idx0)!,
          indexMap.get(idx1)!,
          indexMap.get(idx2)!,
        );
      }
    }

    const newHoles: number[] = [];
    for (const holeIndex of holes) {
      if (holeIndex < vertexIndices.length) {
        newHoles.push(holeIndex);
      }
    }

    groups.push({
      holes: new Uint32Array(newHoles),
      positions: new Float64Array(newPositions),
      triangles: new Uint32Array(newTriangles),
    });
  }

  return groups;
}
