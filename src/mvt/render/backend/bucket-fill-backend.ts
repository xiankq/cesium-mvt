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
import { BufferPolygon, BufferPolygonCollection } from 'cesium';
import { isValidTypedArray, validatePositions } from '../../utils/validation';
import { getFillMaterial } from './material-cache';

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
  style: StyleSpecification;
}

export function createBucketFillTileHandle({
  bucketTile,
  style,
}: CreateBucketFillTileHandleOptions): BucketFillTileHandle | undefined {
  const fillBuckets = bucketTile.buckets.filter(isFillBucket);
  if (fillBuckets.length === 0) {
    return undefined;
  }

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
      const material = getFillMaterial(style, layer);

      collection.add(
        {
          holes: data.holes,
          material,
          positions: data.positions,
          triangles: data.triangles,
        },
        flyweight,
      );

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
  return true;
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
