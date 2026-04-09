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

    if (stats.vertexCount === 0 || data.positions.length === 0) {
      continue;
    }

    if (!validateFillBucketData(data)) {
      continue;
    }

    if (!validatePositions(data.positions)) {
      continue;
    }

    for (const layerId of bucket.layerIds) {
      const layer = layersById.get(layerId);
      if (!layer) {
        continue;
      }

      const collection = new BufferPolygonCollection({
        holeCountMax: stats.holeCount || 0,
        primitiveCountMax: stats.polygonCount || 1,
        triangleCountMax: stats.triangleCount || 0,
        vertexCountMax: stats.vertexCount || 0,
      });
      const flyweight = new BufferPolygon();
      const material = createFillMaterial(layer);

      collection.add({
        holes: data.holes,
        material,
        positions: data.positions,
        triangles: data.triangles,
      }, flyweight);

      collections.push({
        byteLength: collection.byteLength,
        collection,
        layerId,
        polygonCount: stats.polygonCount || 1,
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
  if (!data.positions || !(data.positions instanceof Float64Array)) {
    return false;
  }
  if (!data.triangles || !(data.triangles instanceof Uint32Array)) {
    return false;
  }
  if (!data.holes || !(data.holes instanceof Uint32Array)) {
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
