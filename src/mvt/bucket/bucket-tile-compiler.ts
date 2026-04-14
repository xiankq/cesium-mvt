import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { TileProjectionData } from '../geometry/tile-projection';
import type { GeometryBatch, RenderTile } from '../render/render-tile';
import type { ParsedTile } from '../source/vector-tile';
import type { ParsedTileResult } from './bucket-types';
import { getSourceLayer, parseVectorTile } from '../source/vector-tile';
import { createFeatureFilter } from '../style/feature-filter';
import { isSupportedGeometryLayer } from '../style/layer-family';
import { CircleBucketBuilder } from './circle-bucket-builder';
import { FillBucketBuilder } from './fill-bucket-builder';
import { LineBucketBuilder } from './line-bucket-builder';
import { SymbolBucketBuilder } from './symbol-bucket-builder';

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
  style: StyleSpecification;
  tile: ParsedTile;
  tileProjection: TileProjectionData;
}

/**
 * 从原始数据编译桶瓦片的选项
 */
export interface CompileBucketTileFromDataOptions {
  renderTile: RenderTile;
  style: StyleSpecification;
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
    style: options.style,
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
  const { renderTile, style, tile, tileProjection } = options;

  const zoom = parseZoomFromTileKey(renderTile.key);
  const layersById = new Map(style.layers.map(layer => [layer.id, layer]));

  const buckets: ParsedTileResult['buckets'] = [];
  let totalByteLength = 0;

  for (const batch of renderTile.geometryBatches) {
    const batchBuckets = compileGeometryBatch(
      batch,
      tile,
      tileProjection,
      renderTile.key,
      zoom,
      layersById,
    );
    for (const bucket of batchBuckets) {
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
  layersById: ReadonlyMap<string, StyleSpecification['layers'][number]>,
): ParsedTileResult['buckets'] {
  if (!batch.sourceLayer) {
    return [];
  }

  const sourceLayer = getSourceLayer(tile, batch.sourceLayer);
  if (!sourceLayer) {
    return [];
  }

  const layerEntries = batch.layerIds.flatMap((layerId) => {
    const layer = layersById.get(layerId);
    if (!layer || !isSupportedGeometryLayer(layer) || layer.type !== batch.type) {
      return [];
    }

    const builder = createBucketBuilder(
      batch,
      sourceLayer.extent,
      tileProjection,
      tileKey,
      zoom,
      layersById,
      layer.id,
    );
    if (!builder) {
      return [];
    }

    return [{
      layer,
      builder,
      filter: createFeatureFilter(layer.filter),
      shouldFrontloadFilter: !containsFeatureStateExpression(layer.filter),
    }];
  });

  if (layerEntries.length === 0) {
    return [];
  }

  const symbolAcceptsLineGeometry = layerEntries.some(({ layer }) => layer.type === 'symbol'
    && (layer.layout?.['symbol-placement'] === 'line'
      || layer.layout?.['symbol-placement'] === 'line-center'));

  const buckets: ParsedTileResult['buckets'] = [];
  for (let index = 0; index < sourceLayer.length; index += 1) {
    const feature = sourceLayer.feature(index);
    const featureType = getFeatureType(feature.type);
    if (!featureType || !matchesBatchType(batch.type, featureType, symbolAcceptsLineGeometry)) {
      continue;
    }

    const context = {
      geometryType: featureType,
      id: feature.id,
      properties: feature.properties as Record<string, unknown>,
      zoom,
    };

    for (const entry of layerEntries) {
      if (entry.shouldFrontloadFilter && !entry.filter(context)) {
        continue;
      }

      entry.builder.addFeature(feature, index);
    }
  }

  for (const entry of layerEntries) {
    const bucket = entry.builder.build();
    if (bucket.stats.featureCount === 0) {
      continue;
    }

    buckets.push(bucket);
  }

  return buckets;
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
  layersById: ReadonlyMap<string, StyleSpecification['layers'][number]>,
  layerId: string,
) {
  const options = {
    extent,
    familyId: batch.familyId,
    layerIds: [layerId],
    sourceLayer: batch.sourceLayer,
    tileProjection,
    tileKey,
    zoom,
    symbolPlacement: resolveSymbolPlacement(batch, layerId, layersById),
    symbolSpacing: resolveSymbolSpacing(batch, layerId, layersById),
  };

  switch (batch.type) {
    case 'fill':
      return new FillBucketBuilder(options);
    case 'fill-extrusion':
      return new FillBucketBuilder({
        ...options,
        bucketType: 'fill-extrusion',
      });
    case 'line':
      return new LineBucketBuilder(options);
    case 'circle':
      return new CircleBucketBuilder(options);
    case 'symbol':
      return new SymbolBucketBuilder(options);
    default:
      return undefined;
  }
}

function resolveSymbolPlacement(
  batch: GeometryBatch,
  layerId: string,
  layersById: ReadonlyMap<string, StyleSpecification['layers'][number]>,
): 'point' | 'line' | 'line-center' | undefined {
  if (batch.type !== 'symbol') {
    return undefined;
  }

  const layer = layersById.get(layerId);
  const symbolPlacement = layer?.type === 'symbol'
    ? layer.layout?.['symbol-placement']
    : undefined;

  if (symbolPlacement === 'line' || symbolPlacement === 'line-center') {
    return symbolPlacement;
  }

  return 'point';
}

function resolveSymbolSpacing(
  batch: GeometryBatch,
  layerId: string,
  layersById: ReadonlyMap<string, StyleSpecification['layers'][number]>,
): number | undefined {
  if (batch.type !== 'symbol') {
    return undefined;
  }

  const layer = layersById.get(layerId);
  const symbolSpacing = layer?.type === 'symbol'
    ? layer.layout?.['symbol-spacing']
    : undefined;

  return typeof symbolSpacing === 'number' ? symbolSpacing : undefined;
}

function getFeatureType(type: 0 | 1 | 2 | 3) {
  switch (type) {
    case 1:
      return 'point';
    case 2:
      return 'line';
    case 3:
      return 'polygon';
    default:
      return undefined;
  }
}

function matchesBatchType(
  batchType: GeometryBatch['type'],
  featureType: ReturnType<typeof getFeatureType>,
  symbolAcceptsLineGeometry = false,
) {
  return (batchType === 'circle' && featureType === 'point')
    || (batchType === 'line' && featureType === 'line')
    || (batchType === 'fill' && featureType === 'polygon')
    || (batchType === 'fill-extrusion' && featureType === 'polygon')
    || (batchType === 'symbol' && featureType === 'point')
    || (batchType === 'symbol' && symbolAcceptsLineGeometry && featureType === 'line');
}

function containsFeatureStateExpression(value: unknown): boolean {
  if (Array.isArray(value)) {
    if (value[0] === 'feature-state') {
      return true;
    }

    return value.some(entry => containsFeatureStateExpression(entry));
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .some(entry => containsFeatureStateExpression(entry));
  }

  return false;
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
