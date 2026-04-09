import type { TilingScheme } from 'cesium';
import type { GeometryBatch, RenderTile } from '../render/render-tile';
import type { ParsedTile } from '../source/vector-tile';
import type { ParsedTileResult } from './bucket/bucket-types';
import { getSourceLayer, parseVectorTile } from '../source/vector-tile';
import { CircleBucketBuilder } from './bucket/circle-bucket-builder';
import { FillBucketBuilder } from './bucket/fill-bucket-builder';
import { LineBucketBuilder } from './bucket/line-bucket-builder';

export interface CompileBucketTileOptions {
  renderTile: RenderTile;
  tile: ParsedTile;
  tilingScheme: TilingScheme;
}

export interface CompileBucketTileFromDataOptions {
  renderTile: RenderTile;
  tileData: ArrayBuffer;
  tilingScheme: TilingScheme;
}

export function compileBucketTileFromData(
  options: CompileBucketTileFromDataOptions,
): ParsedTileResult {
  return compileBucketTile({
    renderTile: options.renderTile,
    tile: parseVectorTile(options.tileData),
    tilingScheme: options.tilingScheme,
  });
}

export function compileBucketTile(
  options: CompileBucketTileOptions,
): ParsedTileResult {
  const { renderTile, tile, tilingScheme } = options;

  const buckets: ParsedTileResult['buckets'] = [];
  let totalByteLength = 0;

  for (const batch of renderTile.geometryBatches) {
    const bucket = compileGeometryBatch(batch, tile, tilingScheme, renderTile.key);
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
  tilingScheme: TilingScheme,
  tileKey: string,
) {
  if (!batch.sourceLayer) {
    return undefined;
  }

  const sourceLayer = getSourceLayer(tile, batch.sourceLayer);
  if (!sourceLayer) {
    return undefined;
  }

  const builder = createBucketBuilder(batch, sourceLayer.extent, tilingScheme, tileKey);
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
  tilingScheme: TilingScheme,
  tileKey: string,
) {
  const { level, x, y } = parseTileCoordinateFromKey(tileKey);

  const options = {
    extent,
    familyId: batch.familyId,
    layerIds: batch.layerIds,
    sourceLayer: batch.sourceLayer,
    tilingScheme,
    level,
    x,
    y,
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

function parseTileCoordinateFromKey(key: string) {
  const scopedKey = key.split('@')[0];
  const parts = scopedKey.split('/');

  if (parts.length < 4) {
    return { level: 0, x: 0, y: 0 };
  }

  const level = Number(parts[parts.length - 3]);
  const x = Number(parts[parts.length - 2]);
  const y = Number(parts[parts.length - 1]);

  if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return { level: 0, x: 0, y: 0 };
  }

  return { level, x, y };
}
