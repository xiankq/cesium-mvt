import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ParsedTile } from '@/mvt/source/vector-tile';
import { describe, expect, it } from 'vitest';
import { createMockStyle } from '../../helpers/style-helpers';

describe('bucket-tile-compiler', () => {
  describe('compileBucketTile', () => {
    it('should compile render tile to bucket tile', async () => {
      const { compileBucketTile } = await import('@/mvt/bucket/bucket-tile-compiler');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const renderTile = createMockRenderTile();
      const tile = createMockParsedTile() as unknown as ParsedTile;
      const style = createMockStyle('fill');

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toBeDefined();
      expect(result.epoch).toBe(renderTile.epoch);
      expect(result.key).toBe(renderTile.key);
      expect(result.byteLength).toBeGreaterThan(0);
    });

    it('should create fill bucket for fill batch', async () => {
      const { compileBucketTile } = await import('@/mvt/bucket/bucket-tile-compiler');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const renderTile = createMockRenderTile('fill');
      const tile = createMockParsedTile() as unknown as ParsedTile;
      const style = createMockStyle('fill');

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('fill');
    });

    it('should create line bucket for line batch', async () => {
      const { compileBucketTile } = await import('@/mvt/bucket/bucket-tile-compiler');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const renderTile = createMockRenderTile('line');
      const tile = createMockParsedTile('line') as unknown as ParsedTile;
      const style = createMockStyle('line');

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('line');
    });

    it('should create circle bucket for circle batch', async () => {
      const { compileBucketTile } = await import('@/mvt/bucket/bucket-tile-compiler');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const renderTile = createMockRenderTile('circle');
      const tile = createMockParsedTile('circle') as unknown as ParsedTile;
      const style = createMockStyle('circle');

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('circle');
    });

    it('should keep layer semantics separate when a family contains multiple layers', async () => {
      const { compileBucketTile } = await import('@/mvt/bucket/bucket-tile-compiler');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const renderTile = {
        epoch: 1,
        key: 'source/0/0/0',
        geometryBatches: [
          {
            backend: 'fill' as const,
            familyId: 'source/layer/fill/0',
            layerIds: ['park', 'water'],
            order: 0,
            sourceId: 'source',
            sourceLayer: 'layer',
            type: 'fill' as const,
          },
        ],
      };
      const tile = createMockParsedTileWithTwoFeatures() as unknown as ParsedTile;
      const style = createLayerSeparatedStyle();

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(2);
      expect(result.buckets.map(bucket => bucket.layerIds)).toEqual([
        ['park'],
        ['water'],
      ]);
      expect(result.buckets.map(bucket => bucket.stats.featureCount)).toEqual([
        1,
        1,
      ]);
    });

    it('should keep feature-state filters for runtime evaluation', async () => {
      const { compileBucketTile } = await import('@/mvt/bucket/bucket-tile-compiler');
      const { WebMercatorTilingScheme } = await import('cesium');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const tileProjection = {
        west: rect.west,
        south: rect.south,
        east: rect.east,
        north: rect.north,
      };
      const renderTile = {
        epoch: 1,
        key: 'source/0/0/0',
        geometryBatches: [
          {
            backend: 'fill' as const,
            familyId: 'source/layer/fill/0',
            layerIds: ['selected'],
            order: 0,
            sourceId: 'source',
            sourceLayer: 'layer',
            type: 'fill' as const,
          },
        ],
      };
      const tile = createMockParsedTileWithTwoFeatures() as unknown as ParsedTile;
      const style = createFeatureStateStyle();

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].stats.featureCount).toBe(2);
    });
  });
});

function createMockRenderTile(type: 'fill' | 'line' | 'circle' = 'fill') {
  return {
    epoch: 1,
    key: 'source/0/0/0',
    geometryBatches: [
      {
        type,
        backend: type,
        familyId: `source/layer/${type}/0`,
        layerIds: ['layer1'],
        sourceLayer: 'layer',
        order: 0,
        sourceId: 'source',
      },
    ],
  };
}

function createMockParsedTile(type: 'fill' | 'line' | 'circle' = 'fill') {
  return {
    layers: {
      layer: {
        extent: 4096,
        length: 1,
        feature: () => {
          if (type === 'line') {
            return {
              id: 1,
              loadGeometry: () => [[
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 200, y: 100 },
              ]],
              properties: { name: 'test' },
              type: 2,
            };
          }

          if (type === 'circle') {
            return {
              id: 1,
              loadGeometry: () => [[
                { x: 0, y: 0 },
              ]],
              properties: { name: 'test' },
              type: 1,
            };
          }

          return {
            id: 1,
            loadGeometry: () => [[
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
              { x: 0, y: 0 },
            ]],
            properties: { name: 'test' },
            type: 3,
          };
        },
      },
    },
  };
}

function createMockParsedTileWithTwoFeatures() {
  return {
    layers: {
      layer: {
        extent: 4096,
        length: 2,
        feature: (index: number) => ({
          type: 3,
          id: index + 1,
          properties: index === 0
            ? { kind: 'park' }
            : { kind: 'water' },
          loadGeometry: () => [[
            { x: index * 100, y: 0 },
            { x: index * 100 + 100, y: 0 },
            { x: index * 100 + 100, y: 100 },
            { x: index * 100, y: 100 },
            { x: index * 100, y: 0 },
          ]],
        }),
      },
    },
  };
}

function createLayerSeparatedStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      source: {
        type: 'vector',
        tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        'id': 'park',
        'type': 'fill',
        'source': 'source',
        'source-layer': 'layer',
        'filter': ['==', ['get', 'kind'], 'park'],
      },
      {
        'id': 'water',
        'type': 'fill',
        'source': 'source',
        'source-layer': 'layer',
        'filter': ['==', ['get', 'kind'], 'water'],
      },
    ],
  };
}

function createFeatureStateStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      source: {
        type: 'vector',
        tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        'id': 'selected',
        'type': 'fill',
        'source': 'source',
        'source-layer': 'layer',
        'filter': ['==', ['feature-state', 'selected'], true] as any,
      },
    ],
  };
}
