import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { SymbolBucketStats } from '@/mvt/bucket/bucket-types';
import type { ParsedTile } from '@/mvt/source/vector-tile';
import { describe, expect, it } from 'vitest';
import { StyleManager } from '@/mvt/style/style-manager';
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

    it('should compile bucket tile with a precomputed style index', async () => {
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
      const styleManager = new StyleManager();
      styleManager.updateStyle({ style });

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
        styleIndex: styleManager.getStyleIndex()!,
      } as any);

      expect(result.buckets).toBeDefined();
      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('fill');
    });

    it('should create fill-extrusion bucket for fill-extrusion batch', async () => {
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
      const renderTile = createMockRenderTile('fill-extrusion');
      renderTile.geometryBatches[0]!.layerIds = ['building'];
      renderTile.geometryBatches[0]!.familyId = 'source/building/fill-extrusion/0';
      const tile = createMockParsedTile('fill-extrusion') as unknown as ParsedTile;
      const style: StyleSpecification = {
        version: 8,
        sources: {
          source: {
            type: 'vector',
            tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
          },
        },
        layers: [
          {
            'id': 'building',
            'type': 'fill-extrusion',
            'source': 'source',
            'source-layer': 'layer',
            'paint': {
              'fill-extrusion-color': '#556677',
              'fill-extrusion-height': 32,
            },
          },
        ],
      };

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('fill-extrusion');
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

    it('should create symbol bucket for line-center symbol batch', async () => {
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
      const renderTile = createMockRenderTile('symbol');
      const tile = createMockParsedTile('symbol') as unknown as ParsedTile;
      const style: StyleSpecification = {
        version: 8,
        sources: {
          source: {
            type: 'vector',
            tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
          },
        },
        layers: [
          {
            'id': 'poi',
            'type': 'symbol',
            'source': 'source',
            'source-layer': 'layer',
            'layout': {
              'symbol-placement': 'line-center',
              'text-field': ['get', 'name'],
            },
          },
        ],
      };

      renderTile.geometryBatches[0]!.layerIds = ['poi'];
      renderTile.geometryBatches[0]!.familyId = 'source/layer/symbol/0';

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('symbol');
      expect((result.buckets[0].stats as SymbolBucketStats).labelCount).toBe(1);
    });

    it('should create repeated symbol anchors for line placement batch', async () => {
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
      const renderTile = createMockRenderTile('symbol');
      const tile = createMockParsedTile('symbol') as unknown as ParsedTile;
      const style: StyleSpecification = {
        version: 8,
        sources: {
          source: {
            type: 'vector',
            tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
          },
        },
        layers: [
          {
            'id': 'road-label',
            'type': 'symbol',
            'source': 'source',
            'source-layer': 'layer',
            'layout': {
              'symbol-placement': 'line',
              'symbol-spacing': 250,
              'text-field': ['get', 'name'],
            },
          },
        ],
      };

      renderTile.geometryBatches[0]!.layerIds = ['road-label'];
      renderTile.geometryBatches[0]!.familyId = 'source/layer/symbol/0';

      const result = compileBucketTile({
        renderTile,
        style,
        tile,
        tileProjection,
      } as any);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('symbol');
      expect((result.buckets[0].stats as SymbolBucketStats).labelCount).toBeGreaterThan(1);
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

function createMockRenderTile(type: 'fill' | 'fill-extrusion' | 'line' | 'circle' | 'symbol' = 'fill') {
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

function createMockParsedTile(type: 'fill' | 'fill-extrusion' | 'line' | 'circle' | 'symbol' = 'fill') {
  return {
    layers: {
      layer: {
        extent: 4096,
        length: 1,
        feature: () => {
          if (type === 'line' || type === 'symbol') {
            return {
              id: 1,
              loadGeometry: () => [[
                { x: 0, y: 0 },
                { x: 4096, y: 0 },
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
