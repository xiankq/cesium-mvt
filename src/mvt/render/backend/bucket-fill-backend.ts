import type {
  FillLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { Primitive } from 'cesium';
import type {
  Bucket,
  FillBucketData,
  FillBucketStats,
  ParsedTileResult,
} from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import type { StyleIndex } from '../../style/style-manager';
import { BufferPolygon, BufferPolygonCollection } from 'cesium';
import { createFeatureFilter } from '../../style/filter-adapter';
import { validatePositions } from '../../utils/validation';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { iterateFillPolygons, validateFillBucketData } from './fill-bucket-data';
import { createFillPatternCollections } from './fill-pattern-primitive';
import { getFillMaterial } from './material-cache';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';

export interface BucketFillCollectionHandle {
  byteLength: number;
  collection: BufferPolygonCollection | Primitive;
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
  styleIndex?: StyleIndex;
  tileWidth?: number;
}

export function createBucketFillTileHandle({
  bucketTile,
  featureStateResolver,
  style,
  styleIndex,
  tileWidth,
}: CreateBucketFillTileHandleOptions): BucketFillTileHandle | undefined {
  const fillBuckets = bucketTile.buckets.filter(isFillBucket);
  if (fillBuckets.length === 0) {
    return undefined;
  }

  const { level: zoom, sourceId } = parseRenderTileCoordinateFromKey(bucketTile.key);
  const layersById = styleIndex?.layersById ?? new Map(
    style.layers.map(layer => [layer.id, layer]),
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
      if (!layer || !isFillLayer(layer)) {
        continue;
      }

      if (layer.paint?.['fill-pattern'] !== undefined) {
        const patternCollections = createFillPatternCollections({
          bucket,
          featureStateResolver,
          layer,
          sourceId,
          style,
          tileKey: bucketTile.key,
          tileWidth,
          zoom,
        });
        collections.push(...patternCollections);
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

        if (context.feature && !filter(context)) {
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
