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
import { createSymbolPlacementGrid } from './symbol-placement-grid';

export { resolveSymbolRenderDecision } from './symbol-render-utils';

const WEB_MERCATOR_TILING_SCHEME = new WebMercatorTilingScheme();

export function createBucketSymbolTileHandle({
  bucketTile,
  featureStateResolver,
  tileWidth = 256,
  styleIndex,
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
  const layersById = styleIndex?.layersById ?? new Map(
    style.layers.map(layer => [layer.id, layer]),
  );

  const collections: BucketSymbolCollectionHandle[] = [];
  const placements: BucketSymbolPlacementHandle[] = [];
  const placementGrid = createSymbolPlacementGrid();

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
        placementGrid,
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
