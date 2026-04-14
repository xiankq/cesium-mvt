import type { TileProjectionData } from '../geometry/tile-projection';
import type { SupportedGeometryLayerType } from '../style/layer-family';

/**
 * Bucket 类型定义模块
 *
 * 该模块定义了 Bucket 系统的核心类型，包括：
 * - Bucket 构建器配置和统计信息
 * - 不同几何类型的数据结构
 * - 特征索引和解析结果
 *
 * Bucket 是向量瓦片数据的中间表示，用于连接数据解析和渲染。
 */

/**
 * Bucket 构建器通用配置选项
 *
 * 所有几何类型的 Bucket 构建器共享相同的配置结构，确保接口一致性
 */
export interface BucketBuilderOptions {
  extent: number;
  familyId: string;
  layerIds: string[];
  sourceLayer?: string;
  symbolPlacement?: 'point' | 'line' | 'line-center';
  symbolSpacing?: number;
  tileProjection: TileProjectionData;
  tileKey: string;
  zoom?: number;
}

/**
 * Bucket 统计信息基类
 */
export interface BucketStats {
  featureCount: number;
  byteLength: number;
}

/**
 * 填充（多边形）Bucket 统计信息
 */
export interface FillBucketStats extends BucketStats {
  type: 'fill';
  vertexCount: number;
  triangleCount: number;
  holeCount: number;
  polygonCount: number;
}

/**
 * 3D 填充 Bucket 统计信息
 */
export interface FillExtrusionBucketStats extends BucketStats {
  type: 'fill-extrusion';
  vertexCount: number;
  triangleCount: number;
  holeCount: number;
  polygonCount: number;
}

/**
 * 线 Bucket 统计信息
 */
export interface LineBucketStats extends BucketStats {
  type: 'line';
  polylineCount: number;
  totalVertexCount: number;
}

/**
 * 圆（点）Bucket 统计信息
 */
export interface CircleBucketStats extends BucketStats {
  type: 'circle';
  pointCount: number;
}

/**
 * 符号 Bucket 统计信息
 */
export interface SymbolBucketStats extends BucketStats {
  type: 'symbol';
  labelCount: number;
  billboardCount: number;
}

/**
 * 几何 Bucket 统计信息联合类型
 */
export type GeometryBucketStats
  = | FillBucketStats
    | FillExtrusionBucketStats
    | LineBucketStats
    | CircleBucketStats
    | SymbolBucketStats;

/**
 * 填充（多边形）Bucket 数据
 */
export interface FillBucketData {
  positions: Float64Array;
  triangles: Uint32Array;
  holes: Uint32Array;
  featureIds: Float32Array;
  polygonHoleCounts?: Uint32Array;
  polygonTriangleCounts?: Uint32Array;
  polygonVertexCounts?: Uint32Array;
}

/**
 * 线 Bucket 数据
 */
export interface LineBucketData {
  positions: Float64Array;
  vertexCounts: Uint32Array;
  featureIds: Float32Array;
}

/**
 * 圆（点）Bucket 数据
 */
export interface CircleBucketData {
  positions: Float64Array;
  featureIds: Float32Array;
}

/**
 * 符号 Bucket 数据
 */
export interface SymbolBucketData {
  positions: Float64Array;
  featureIds: Float32Array;
  lineAngles?: Float32Array;

  // 文本标注数据
  texts?: string[];
  textFonts?: string[];
  textSizes?: number[];
  textColors?: string[];
  textOpacities?: number[];
  textOffsets?: Array<[number, number]>;
  textAnchors?: string[];

  // 图标数据
  iconImages?: string[];
  iconSizes?: number[];
  iconColors?: string[];
  iconOpacities?: number[];
  iconOffsets?: Array<[number, number]>;
  iconAnchors?: string[];
}

/**
 * 几何 Bucket 数据联合类型
 */
export type GeometryBucketData
  = | FillBucketData
    | LineBucketData
    | CircleBucketData
    | SymbolBucketData;

/**
 * 特征索引条目
 *
 * 存储单个特征的基本信息，用于特征查询和交互
 */
export interface FeatureIndexEntry {
  id: number | undefined;
  properties: Record<string, unknown>;
  type: 'point' | 'line' | 'polygon';
}

/**
 * 特征索引
 *
 * 包含所有特征的索引信息和字节长度估算
 */
export interface FeatureIndex {
  entries: FeatureIndexEntry[];
  byteLength: number;
}

/**
 * Bucket
 *
 * 表示单个几何类型的渲染数据，包含统计信息、几何数据和特征索引
 */
export interface Bucket {
  type: SupportedGeometryLayerType;
  familyId: string;
  layerIds: string[];
  sourceLayer?: string;
  stats: GeometryBucketStats;
  data: GeometryBucketData;
  featureIndex: FeatureIndex;
}

/**
 * 解析后的瓦片结果
 *
 * 包含所有 Bucket 和元数据
 */
export interface ParsedTileResult {
  buckets: Bucket[];
  epoch: number;
  key: string;
  byteLength: number;
}

/**
 * 计算 Bucket 的字节长度
 *
 * 根据统计信息估算 Bucket 占用的内存大小
 *
 * @param stats - Bucket 统计信息
 * @returns 字节长度
 */
export function calculateBucketByteLength(stats: GeometryBucketStats): number {
  switch (stats.type) {
    case 'fill':
    case 'fill-extrusion':
      return stats.vertexCount * 3 * 8
        + stats.triangleCount * 3 * 4
        + stats.holeCount * 4
        + stats.vertexCount * 4
        + stats.polygonCount * 4 * 3;
    case 'line':
      return stats.totalVertexCount * 3 * 8
        + stats.polylineCount * 4
        + stats.polylineCount * 4;
    case 'circle':
      return stats.pointCount * 3 * 8
        + stats.pointCount * 4;
    case 'symbol':
      return stats.labelCount * 100
        + stats.billboardCount * 100;
  }
}

/**
 * 计算 FeatureIndex 的字节长度估算值
 *
 * 估算依据：
 * - FeatureIndexEntry包含：
 *   - id: number | undefined (约8 bytes)
 *   - properties: Record<string, unknown> (变长，平均约150 bytes)
 *   - type: 'point' | 'line' | 'polygon' (约10 bytes)
 * - 总计约170 bytes，预留30 bytes用于序列化开销
 * - 最终估值：200 bytes per entry
 *
 * 这里按真实存在的条目数计算，而不是按数组长度计算，
 * 这样 sparse featureIndex 也不会被错误放大。
 *
 * @param entries - FeatureIndex 条目数组
 * @returns 字节长度估算值
 */
export function calculateFeatureIndexByteLength(
  entries: ReadonlyArray<FeatureIndexEntry | undefined>,
): number {
  const entryCount = entries.reduce(
    (count, entry) => count + (entry ? 1 : 0),
    0,
  );

  return entryCount * 200;
}
