import type { TileProjectionData } from '../geometry/tile-projection';
import type { GeometryBatch, RenderTile } from '../render/render-tile';
import type { ParsedTile } from '../source/vector-tile';
import type { ParsedTileResult } from './bucket-types';
import { getSourceLayer, parseVectorTile } from '../source/vector-tile';
import { CircleBucketBuilder } from './circle-bucket-builder';
import { FillBucketBuilder } from './fill-bucket-builder';
import { LineBucketBuilder } from './line-bucket-builder';

/**
 * Bucket 瓦片编译器模块
 *
 * 该模块负责将解析后的向量瓦片数据编译为 Bucket 数据结构，
 * 用于后续的渲染和交互。
 *
 * 编译流程：
 * 1. 解析瓦片数据（如果传入的是原始数据）
 * 2. 遍历几何批次，为每个批次创建对应的 Bucket 构建器
 * 3. 将特征添加到构建器中
 * 4. 构建最终的 Bucket 数据结构
 */

/**
 * 编译桶瓦片的选项
 */
export interface CompileBucketTileOptions {
  renderTile: RenderTile;
  tile: ParsedTile;
  tileProjection: TileProjectionData;
}

/**
 * 从原始数据编译桶瓦片的选项
 */
export interface CompileBucketTileFromDataOptions {
  renderTile: RenderTile;
  tileData: ArrayBuffer;
  tileProjection: TileProjectionData;
}

/**
 * 从原始数据编译桶瓦片
 *
 * @param options - 编译选项
 * @returns 解析后的瓦片结果
 */
export function compileBucketTileFromData(
  options: CompileBucketTileFromDataOptions,
): ParsedTileResult {
  return compileBucketTile({
    renderTile: options.renderTile,
    tile: parseVectorTile(options.tileData),
    tileProjection: options.tileProjection,
  });
}

/**
 * 编译桶瓦片
 *
 * 将解析后的瓦片数据编译为渲染用的桶数据结构
 *
 * @param options - 编译选项
 * @returns 解析后的瓦片结果
 */
export function compileBucketTile(
  options: CompileBucketTileOptions,
): ParsedTileResult {
  const { renderTile, tile, tileProjection } = options;

  const zoom = parseZoomFromTileKey(renderTile.key);

  const buckets: ParsedTileResult['buckets'] = [];
  let totalByteLength = 0;

  for (const batch of renderTile.geometryBatches) {
    const bucket = compileGeometryBatch(batch, tile, tileProjection, renderTile.key, zoom);
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

/**
 * 编译几何批次
 *
 * 将单个几何批次编译为桶数据
 *
 * @param batch - 几何批次
 * @param tile - 解析后的瓦片
 * @param tileProjection - 瓦片投影数据
 * @param tileKey - 瓦片键
 * @param zoom - 缩放级别
 * @returns 编译后的桶数据，如果无法编译则返回undefined
 */
function compileGeometryBatch(
  batch: GeometryBatch,
  tile: ParsedTile,
  tileProjection: TileProjectionData,
  tileKey: string,
  zoom: number,
) {
  if (!batch.sourceLayer) {
    return undefined;
  }

  const sourceLayer = getSourceLayer(tile, batch.sourceLayer);
  if (!sourceLayer) {
    return undefined;
  }

  const builder = createBucketBuilder(batch, sourceLayer.extent, tileProjection, tileKey, zoom);
  if (!builder) {
    return undefined;
  }

  for (let index = 0; index < sourceLayer.length; index += 1) {
    const feature = sourceLayer.feature(index);
    builder.addFeature(feature, index);
  }

  return builder.build();
}

/**
 * 创建 Bucket 构建器
 *
 * 根据几何类型创建对应的构建器实例
 *
 * @param batch - 几何批次
 * @param extent - 瓦片范围
 * @param tileProjection - 瓦片投影数据
 * @param tileKey - 瓦片键
 * @param zoom - 缩放级别
 * @returns Bucket 构建器实例，如果不支持的类型则返回 undefined
 */
function createBucketBuilder(
  batch: GeometryBatch,
  extent: number,
  tileProjection: TileProjectionData,
  tileKey: string,
  zoom: number,
) {
  const options = {
    extent,
    familyId: batch.familyId,
    layerIds: batch.layerIds,
    sourceLayer: batch.sourceLayer,
    tileProjection,
    tileKey,
    zoom,
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

/**
 * 从瓦片键解析缩放级别
 *
 * @param key - 瓦片键（格式：sourceId/level/x/y 或 sourceId/level/x/y@epoch）
 * @returns 缩放级别
 */
function parseZoomFromTileKey(key: string): number {
  const scopedKey = key.split('@')[0];
  const parts = scopedKey.split('/');

  if (parts.length < 4) {
    return 0;
  }

  const level = Number(parts[parts.length - 3]);

  if (!Number.isInteger(level)) {
    return 0;
  }

  return level;
}
