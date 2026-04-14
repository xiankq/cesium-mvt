import type { StyleSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  Bucket,
  SymbolBucketData,
  SymbolBucketStats,
} from '../../bucket/bucket-types';
import type {
  BucketSymbolCollectionHandle,
  BucketSymbolPlacementHandle,
  BucketSymbolTileHandle,
  CreateBucketSymbolTileHandleOptions,
} from './bucket-symbol-types';
import { WebMercatorTilingScheme } from 'cesium';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { createSymbolCollections } from './bucket-symbol-collection-builder';

export { resolveSymbolRenderDecision } from './symbol-render-utils';

const WEB_MERCATOR_TILING_SCHEME = new WebMercatorTilingScheme();

export function createBucketSymbolTileHandle({
  bucketTile,
  featureStateResolver,
  tileWidth = 256,
  style,
}: CreateBucketSymbolTileHandleOptions): BucketSymbolTileHandle | undefined {
  const symbolBuckets = bucketTile.buckets.filter(isSymbolBucket);
  if (symbolBuckets.length === 0) {
    return undefined;
  }

  const coordinate = parseRenderTileCoordinateFromKey(bucketTile.key);
  const { level: zoom, sourceId } = coordinate;
  const tileRectangle = WEB_MERCATOR_TILING_SCHEME.tileXYToNativeRectangle(
    coordinate.x,
    coordinate.y,
    zoom,
  );
  const layersById = new Map(
    style.layers.filter(isSymbolLayer).map(layer => [layer.id, layer]),
  );

  const collections: BucketSymbolCollectionHandle[] = [];
  const placements: BucketSymbolPlacementHandle[] = [];

  for (const bucket of symbolBuckets) {
    for (const layerId of bucket.layerIds) {
      const symbolCollections = createSymbolCollections(
        bucket,
        layerId,
        layersById,
        featureStateResolver,
        style,
        sourceId,
        zoom,
        coordinate,
        tileWidth,
        tileRectangle,
      );
      if (symbolCollections.collections.length > 0) {
        collections.push(...symbolCollections.collections);
        placements.push(...symbolCollections.placements);
      }
    }
  }

  if (collections.length === 0) {
    return undefined;
  }

  return {
    byteLength: collections.reduce(
      (total, c) => total + c.byteLength,
      0,
    ),
    collections,
    placements,
    key: bucketTile.key,
  };
}

function isSymbolBucket(bucket: Bucket): bucket is Bucket & {
  data: SymbolBucketData;
  stats: SymbolBucketStats;
} {
  return bucket.type === 'symbol';
}

function isSymbolLayer(
  layer: StyleSpecification['layers'][number],
): layer is SymbolLayerSpecification {
  return layer.type === 'symbol';
}
