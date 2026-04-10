import type { GeometryBatch, RenderTile } from '../render/render-tile';
import type { ParsedTile } from '../source/vector-tile';
import type { ParsedTileResult } from './bucket/bucket-types';
import type { TileProjectionData } from './geometry/tile-projection';
import { getSourceLayer, parseVectorTile } from '../source/vector-tile';
import { CircleBucketBuilder } from './bucket/circle-bucket-builder';
import { FillBucketBuilder } from './bucket/fill-bucket-builder';
import { LineBucketBuilder } from './bucket/line-bucket-builder';

export interface CompileBucketTileOptions {
  renderTile: RenderTile;
  tile: ParsedTile;
  tileProjection: TileProjectionData;
}

export interface CompileBucketTileFromDataOptions {
  renderTile: RenderTile;
  tileData: ArrayBuffer;
  tileProjection: TileProjectionData;
}

export function compileBucketTileFromData(
  options: CompileBucketTileFromDataOptions,
): ParsedTileResult {
  return compileBucketTile({
    renderTile: options.renderTile,
    tile: parseVectorTile(options.tileData),
    tileProjection: options.tileProjection,
  });
}

export function compileBucketTile(
  options: CompileBucketTileOptions,
): ParsedTileResult {
  const { renderTile, tile, tileProjection } = options;

  const buckets: ParsedTileResult['buckets'] = [];
  let totalByteLength = 0;

  for (const batch of renderTile.geometryBatches) {
    const bucket = compileGeometryBatch(batch, tile, tileProjection, renderTile.key);
    if (bucket) {
      buckets.push(bucket);
      totalByteLength += bucket.stats.byteLength;
    }
  }

  return {
    buckets,
    epoch: renderTile.epoch,
    key: renderTile.key,
    byteLength: totalByteLength,
  };
}

function compileGeometryBatch(
  batch: GeometryBatch,
  tile: ParsedTile,
  tileProjection: TileProjectionData,
  tileKey: string,
) {
  if (!batch.sourceLayer) {
    return undefined;
  }

  const sourceLayer = getSourceLayer(tile, batch.sourceLayer);
  if (!sourceLayer) {
    return undefined;
  }

  const builder = createBucketBuilder(batch, sourceLayer.extent, tileProjection, tileKey);
  if (!builder) {
    return undefined;
  }

  for (let index = 0; index < sourceLayer.length; index += 1) {
    const feature = sourceLayer.feature(index);
    builder.addFeature(feature, index);
  }

  return builder.build();
}

function createBucketBuilder(
  batch: GeometryBatch,
  extent: number,
  tileProjection: TileProjectionData,
  tileKey: string,
) {
  const options = {
    extent,
    familyId: batch.familyId,
    filter: batch.filter,
    layerIds: batch.layerIds,
    sourceLayer: batch.sourceLayer,
    tileProjection,
    tileKey,
  };

  switch (batch.type) {
    case 'fill':
      return new FillBucketBuilder(options);
    case 'line':
      return new LineBucketBuilder(options);
    case 'circle':
      return new CircleBucketBuilder(options);
    default:
      return undefined;
  }
}
