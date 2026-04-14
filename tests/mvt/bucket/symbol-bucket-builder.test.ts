import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { SymbolBucketStats } from '@/mvt/bucket/bucket-types';
import { WebMercatorTilingScheme } from 'cesium';
import { describe, expect, it } from 'vitest';
import { SymbolBucketBuilder } from '@/mvt/bucket/symbol-bucket-builder';

describe('symbol-bucket-builder', () => {
  it('应该按符号点位数量计算字节长度', () => {
    const builder = new SymbolBucketBuilder(createBucketOptions());

    builder.addFeature(createSymbolFeature(), 0);

    const bucket = builder.build();
    const stats = bucket.stats as SymbolBucketStats;

    expect(bucket.type).toBe('symbol');
    expect(stats.featureCount).toBe(1);
    expect(stats.labelCount).toBe(2);
    expect(stats.byteLength).toBe(200);
    expect(bucket.data.positions).toHaveLength(6);
    expect(bucket.data.featureIds).toHaveLength(2);
    expect(bucket.featureIndex.entries[0]).toMatchObject({
      id: 7,
      properties: {
        name: 'museum',
      },
      type: 'point',
    });
  });

  it('应该忽略 tile 边界外的符号锚点', () => {
    const builder = new SymbolBucketBuilder(createBucketOptions());

    builder.addFeature(createOutOfBoundsSymbolFeature(), 0);

    const bucket = builder.build();
    const stats = bucket.stats as SymbolBucketStats;

    expect(stats.labelCount).toBe(1);
    expect(bucket.data.positions).toHaveLength(3);
    expect(bucket.data.featureIds).toHaveLength(1);
  });

  it('应该为 line-center 符号生成线中心锚点', () => {
    const builder = new SymbolBucketBuilder(createBucketOptions('line-center') as any);

    builder.addFeature(createLineCenterFeature(), 0);

    const bucket = builder.build();
    const stats = bucket.stats as SymbolBucketStats;

    expect(stats.labelCount).toBe(1);
    expect(bucket.data.positions).toHaveLength(3);
    expect(bucket.data.featureIds).toHaveLength(1);
  });

  it('应该为 line placement 生成多个锚点', () => {
    const builder = new SymbolBucketBuilder({
      ...createBucketOptions('line-center'),
      symbolPlacement: 'line',
      symbolSpacing: 250,
    } as any);

    builder.addFeature(createLongLineFeature(), 0);

    const bucket = builder.build();
    const stats = bucket.stats as SymbolBucketStats;

    expect(stats.labelCount).toBeGreaterThan(1);
    expect(bucket.data.positions).toHaveLength(stats.labelCount * 3);
    expect(bucket.data.featureIds).toHaveLength(stats.labelCount);
  });
});

function createBucketOptions(symbolPlacement?: 'point' | 'line' | 'line-center') {
  const tilingScheme = new WebMercatorTilingScheme();
  const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);

  return {
    extent: 4096,
    familyId: 'source/layer/symbol/0',
    layerIds: ['poi-layer'],
    sourceLayer: 'layer',
    symbolPlacement,
    tileKey: 'source/0/0/0',
    tileProjection: {
      east: rect.east,
      north: rect.north,
      south: rect.south,
      west: rect.west,
    },
  };
}

function createSymbolFeature(): VectorTileFeature {
  return {
    id: 7,
    loadGeometry: () => [
      [{ x: 512, y: 512 }],
      [{ x: 1024, y: 1024 }],
    ],
    properties: {
      name: 'museum',
    },
    type: 1,
  } as unknown as VectorTileFeature;
}

function createOutOfBoundsSymbolFeature(): VectorTileFeature {
  return {
    id: 9,
    loadGeometry: () => [
      [{ x: 512, y: 512 }],
      [{ x: 512, y: -16 }],
    ],
    properties: {
      name: 'library',
    },
    type: 1,
  } as unknown as VectorTileFeature;
}

function createLineCenterFeature(): VectorTileFeature {
  return {
    id: 11,
    loadGeometry: () => [
      [
        { x: 512, y: 512 },
        { x: 1024, y: 1024 },
      ],
    ],
    properties: {
      name: 'river',
    },
    type: 2,
  } as unknown as VectorTileFeature;
}

function createLongLineFeature(): VectorTileFeature {
  return {
    id: 12,
    loadGeometry: () => [
      [
        { x: 0, y: 0 },
        { x: 4096, y: 0 },
      ],
    ],
    properties: {
      name: 'highway',
    },
    type: 2,
  } as unknown as VectorTileFeature;
}
