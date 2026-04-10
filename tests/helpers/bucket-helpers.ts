import type {
  Bucket,
  CircleBucketData,
  CircleBucketStats,
  FillBucketData,
  FillBucketStats,
  LineBucketData,
  LineBucketStats,
  ParsedTileResult,
} from '@/mvt/bucket/bucket-types';

export interface MockBucketOptions {
  featureCount?: number;
  layerId?: string;
  sourceName?: string;
  tileKey?: string;
}

export function createMockEmptyBucketTile(): ParsedTileResult {
  return {
    buckets: [],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 0,
  };
}

export function createMockLineBucketTile(options: MockBucketOptions = {}): ParsedTileResult {
  const {
    featureCount = 1,
    layerId = 'layer1',
    sourceName = 'source',
    tileKey = 'source/0/0/0',
  } = options;

  const stats: LineBucketStats = {
    type: 'line',
    featureCount,
    byteLength: 100 * featureCount,
    polylineCount: featureCount,
    totalVertexCount: 3 * featureCount,
  };

  const positions: number[] = [];
  const vertexCounts: number[] = [];
  const featureIds: number[] = [];

  for (let i = 0; i < featureCount; i++) {
    const baseX = i * 100;
    positions.push(
      baseX,
      0,
      0,
      baseX + 100,
      0,
      0,
      baseX + 100,
      100,
      0,
    );
    vertexCounts.push(3);
    featureIds.push(i, i, i);
  }

  const data: LineBucketData = {
    positions: new Float64Array(positions),
    vertexCounts: new Uint32Array(vertexCounts),
    featureIds: new Float32Array(featureIds),
  };

  const bucket: Bucket = {
    type: 'line',
    familyId: `${sourceName}/layer/line/0`,
    layerIds: [layerId],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: Array.from({ length: featureCount }, (_, i) => ({
        id: i + 1,
        properties: { name: `test${i + 1}` },
        type: 'line' as const,
      })),
      byteLength: 50 * featureCount,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: tileKey,
    byteLength: stats.byteLength,
  };
}

export function createMockFillBucketTile(options: MockBucketOptions = {}): ParsedTileResult {
  const {
    featureCount = 1,
    layerId = 'layer1',
    sourceName = 'source',
    tileKey = 'source/0/0/0',
  } = options;

  const stats: FillBucketStats = {
    type: 'fill',
    featureCount,
    byteLength: 100 * featureCount,
    polygonCount: featureCount,
    triangleCount: featureCount,
    vertexCount: 3 * featureCount,
    holeCount: 0,
  };

  const positions: number[] = [];
  const triangles: number[] = [];
  const featureIds: number[] = [];

  for (let i = 0; i < featureCount; i++) {
    const baseX = i * 100;
    positions.push(
      baseX,
      0,
      0,
      baseX + 100,
      0,
      0,
      baseX + 100,
      100,
      0,
    );
    const baseIndex = i * 3;
    triangles.push(baseIndex, baseIndex + 1, baseIndex + 2);
    featureIds.push(i, i, i);
  }

  const data: FillBucketData = {
    positions: new Float64Array(positions),
    triangles: new Uint32Array(triangles),
    holes: new Uint32Array([]),
    featureIds: new Float32Array(featureIds),
  };

  const bucket: Bucket = {
    type: 'fill',
    familyId: `${sourceName}/layer/fill/0`,
    layerIds: [layerId],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: Array.from({ length: featureCount }, (_, i) => ({
        id: i + 1,
        properties: { name: `test${i + 1}` },
        type: 'polygon' as const,
      })),
      byteLength: 50 * featureCount,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: tileKey,
    byteLength: stats.byteLength,
  };
}

export function createMockCircleBucketTile(options: MockBucketOptions = {}): ParsedTileResult {
  const {
    featureCount = 1,
    layerId = 'layer1',
    sourceName = 'source',
    tileKey = 'source/0/0/0',
  } = options;

  const stats: CircleBucketStats = {
    type: 'circle',
    featureCount,
    byteLength: 100 * featureCount,
    pointCount: featureCount,
  };

  const positions: number[] = [];
  const featureIds: number[] = [];

  for (let i = 0; i < featureCount; i++) {
    positions.push(i * 100, i * 100, 0);
    featureIds.push(i);
  }

  const data: CircleBucketData = {
    positions: new Float64Array(positions),
    featureIds: new Float32Array(featureIds),
  };

  const bucket: Bucket = {
    type: 'circle',
    familyId: `${sourceName}/layer/circle/0`,
    layerIds: [layerId],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: Array.from({ length: featureCount }, (_, i) => ({
        id: i + 1,
        properties: { name: `test${i + 1}` },
        type: 'point' as const,
      })),
      byteLength: 50 * featureCount,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: tileKey,
    byteLength: stats.byteLength,
  };
}

export function createMockLineBucketTileWithInvalidPositions(): ParsedTileResult {
  const stats: LineBucketStats = {
    type: 'line',
    featureCount: 1,
    byteLength: 100,
    polylineCount: 1,
    totalVertexCount: 3,
  };

  const data: LineBucketData = {
    positions: new Float64Array([0, 0, 0, Number.NaN, 0, 0, 100, 100, 0]),
    vertexCounts: new Uint32Array([3]),
    featureIds: new Float32Array([0, 0, 0]),
  };

  const bucket: Bucket = {
    type: 'line',
    familyId: 'source/layer/line/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'line',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockFillBucketTileWithEmptyPositions(): ParsedTileResult {
  const stats: FillBucketStats = {
    type: 'fill',
    featureCount: 0,
    byteLength: 0,
    polygonCount: 0,
    triangleCount: 0,
    vertexCount: 0,
    holeCount: 0,
  };

  const data: FillBucketData = {
    positions: new Float64Array([]),
    triangles: new Uint32Array([]),
    holes: new Uint32Array([]),
    featureIds: new Float32Array([]),
  };

  const bucket: Bucket = {
    type: 'fill',
    familyId: 'source/layer/fill/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [],
      byteLength: 0,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 0,
  };
}

export function createMockFillBucketTileWithInvalidPositions(): ParsedTileResult {
  const stats: FillBucketStats = {
    type: 'fill',
    featureCount: 1,
    byteLength: 100,
    polygonCount: 1,
    triangleCount: 1,
    vertexCount: 3,
    holeCount: 0,
  };

  const data: FillBucketData = {
    positions: new Float64Array([0, 0, 0, Number.NaN, 0, 0, 100, 100, 0]),
    triangles: new Uint32Array([0, 1, 2]),
    holes: new Uint32Array([]),
    featureIds: new Float32Array([0, 0, 0]),
  };

  const bucket: Bucket = {
    type: 'fill',
    familyId: 'source/layer/fill/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'polygon',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockFillBucketTileWithMissingLayer(): ParsedTileResult {
  const stats: FillBucketStats = {
    type: 'fill',
    featureCount: 1,
    byteLength: 100,
    polygonCount: 1,
    triangleCount: 1,
    vertexCount: 3,
    holeCount: 0,
  };

  const data: FillBucketData = {
    positions: new Float64Array([0, 0, 0, 100, 0, 0, 100, 100, 0]),
    triangles: new Uint32Array([0, 1, 2]),
    holes: new Uint32Array([]),
    featureIds: new Float32Array([0, 0, 0]),
  };

  const bucket: Bucket = {
    type: 'fill',
    familyId: 'source/layer/fill/0',
    layerIds: ['nonexistent-layer'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'polygon',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockCircleBucketTileWithEmptyPositions(): ParsedTileResult {
  const stats: CircleBucketStats = {
    type: 'circle',
    featureCount: 0,
    byteLength: 0,
    pointCount: 0,
  };

  const data: CircleBucketData = {
    positions: new Float64Array([]),
    featureIds: new Float32Array([]),
  };

  const bucket: Bucket = {
    type: 'circle',
    familyId: 'source/layer/circle/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [],
      byteLength: 0,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 0,
  };
}

export function createMockCircleBucketTileWithInvalidPositions(): ParsedTileResult {
  const stats: CircleBucketStats = {
    type: 'circle',
    featureCount: 1,
    byteLength: 100,
    pointCount: 1,
  };

  const data: CircleBucketData = {
    positions: new Float64Array([Number.NaN, 0, 0]),
    featureIds: new Float32Array([0]),
  };

  const bucket: Bucket = {
    type: 'circle',
    familyId: 'source/layer/circle/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'point',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockCircleBucketTileWithMissingLayer(): ParsedTileResult {
  const stats: CircleBucketStats = {
    type: 'circle',
    featureCount: 1,
    byteLength: 100,
    pointCount: 1,
  };

  const data: CircleBucketData = {
    positions: new Float64Array([0, 0, 0]),
    featureIds: new Float32Array([0]),
  };

  const bucket: Bucket = {
    type: 'circle',
    familyId: 'source/layer/circle/0',
    layerIds: ['nonexistent-layer'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'point',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockLineBucketTileWithInsufficientPositions(): ParsedTileResult {
  const stats: LineBucketStats = {
    type: 'line',
    featureCount: 1,
    byteLength: 100,
    polylineCount: 1,
    totalVertexCount: 3,
  };

  const data: LineBucketData = {
    positions: new Float64Array([0, 0, 0]),
    vertexCounts: new Uint32Array([3]),
    featureIds: new Float32Array([0, 0, 0]),
  };

  const bucket: Bucket = {
    type: 'line',
    familyId: 'source/layer/line/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'line',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockLineBucketTileWithSingleVertex(): ParsedTileResult {
  const stats: LineBucketStats = {
    type: 'line',
    featureCount: 1,
    byteLength: 100,
    polylineCount: 1,
    totalVertexCount: 1,
  };

  const data: LineBucketData = {
    positions: new Float64Array([0, 0, 0]),
    vertexCounts: new Uint32Array([1]),
    featureIds: new Float32Array([0]),
  };

  const bucket: Bucket = {
    type: 'line',
    familyId: 'source/layer/line/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'line',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}

export function createMockLineBucketTileWithEmptyPositions(): ParsedTileResult {
  const stats: LineBucketStats = {
    type: 'line',
    featureCount: 0,
    byteLength: 0,
    polylineCount: 0,
    totalVertexCount: 0,
  };

  const data: LineBucketData = {
    positions: new Float64Array([]),
    vertexCounts: new Uint32Array([]),
    featureIds: new Float32Array([]),
  };

  const bucket: Bucket = {
    type: 'line',
    familyId: 'source/layer/line/0',
    layerIds: ['layer1'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [],
      byteLength: 0,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 0,
  };
}

export function createMockLineBucketTileWithMissingLayer(): ParsedTileResult {
  const stats: LineBucketStats = {
    type: 'line',
    featureCount: 1,
    byteLength: 100,
    polylineCount: 1,
    totalVertexCount: 3,
  };

  const data: LineBucketData = {
    positions: new Float64Array([0, 0, 0, 100, 0, 0, 100, 100, 0]),
    vertexCounts: new Uint32Array([3]),
    featureIds: new Float32Array([0, 0, 0]),
  };

  const bucket: Bucket = {
    type: 'line',
    familyId: 'source/layer/line/0',
    layerIds: ['nonexistent-layer'],
    sourceLayer: 'layer',
    stats,
    data,
    featureIndex: {
      entries: [{
        id: 1,
        properties: { name: 'test' },
        type: 'line',
      }],
      byteLength: 50,
    },
  };

  return {
    buckets: [bucket],
    epoch: 1,
    key: 'source/0/0/0',
    byteLength: 100,
  };
}
