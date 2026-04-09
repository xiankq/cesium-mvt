import type { SupportedGeometryLayerType } from '../../style/layer-family';

export interface BucketStats {
  featureCount: number;
  byteLength: number;
}

export interface FillBucketStats extends BucketStats {
  type: 'fill';
  vertexCount: number;
  triangleCount: number;
  holeCount: number;
  polygonCount: number;
}

export interface LineBucketStats extends BucketStats {
  type: 'line';
  polylineCount: number;
  totalVertexCount: number;
}

export interface CircleBucketStats extends BucketStats {
  type: 'circle';
  pointCount: number;
}

export type GeometryBucketStats
  = | FillBucketStats
    | LineBucketStats
    | CircleBucketStats;

export interface FillBucketData {
  positions: Float64Array;
  triangles: Uint32Array;
  holes: Uint32Array;
  featureIds: Float32Array;
}

export interface LineBucketData {
  positions: Float64Array;
  vertexCounts: Uint32Array;
  featureIds: Float32Array;
}

export interface CircleBucketData {
  positions: Float64Array;
  featureIds: Float32Array;
}

export type GeometryBucketData
  = | FillBucketData
    | LineBucketData
    | CircleBucketData;

export interface FeatureIndexEntry {
  id: number | undefined;
  properties: Record<string, unknown>;
  type: 'point' | 'line' | 'polygon';
}

export interface FeatureIndex {
  entries: FeatureIndexEntry[];
  byteLength: number;
}

export interface Bucket {
  type: SupportedGeometryLayerType;
  familyId: string;
  layerIds: string[];
  sourceLayer?: string;
  stats: GeometryBucketStats;
  data: GeometryBucketData;
  featureIndex: FeatureIndex;
}

export interface ParsedTileResult {
  buckets: Bucket[];
  epoch: number;
  key: string;
  byteLength: number;
}

export function calculateBucketByteLength(stats: GeometryBucketStats): number {
  switch (stats.type) {
    case 'fill':
      return stats.vertexCount * 3 * 8
        + stats.triangleCount * 3 * 4
        + stats.holeCount * 4
        + stats.vertexCount * 4;
    case 'line':
      return stats.totalVertexCount * 3 * 8
        + stats.polylineCount * 4
        + stats.polylineCount * 4;
    case 'circle':
      return stats.pointCount * 3 * 8
        + stats.pointCount * 4;
  }
}

/**
 * 计算FeatureIndex的字节长度估算值
 *
 * 估算依据：
 * - FeatureIndexEntry包含：
 *   - id: number | undefined (约8 bytes)
 *   - properties: Record<string, unknown> (变长，平均约150 bytes)
 *   - type: 'point' | 'line' | 'polygon' (约10 bytes)
 * - 总计约170 bytes，预留30 bytes用于序列化开销
 * - 最终估算值：200 bytes per entry
 */
export function calculateFeatureIndexByteLength(entryCount: number): number {
  return entryCount * 200;
}
