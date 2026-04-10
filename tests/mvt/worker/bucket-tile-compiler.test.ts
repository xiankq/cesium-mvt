import type { ParsedTile } from '../../../src/mvt/source/vector-tile';
import { describe, expect, it } from 'vitest';

describe('bucket-tile-compiler', () => {
  describe('compileBucketTile', () => {
    it('should compile render tile to bucket tile', async () => {
      const { compileBucketTile } = await import('../../../src/mvt/worker/bucket-tile-compiler');
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

      const result = compileBucketTile({
        renderTile,
        tile,
        tileProjection,
      });

      expect(result.buckets).toBeDefined();
      expect(result.epoch).toBe(renderTile.epoch);
      expect(result.key).toBe(renderTile.key);
      expect(result.byteLength).toBeGreaterThan(0);
    });

    it('should create fill bucket for fill batch', async () => {
      const { compileBucketTile } = await import('../../../src/mvt/worker/bucket-tile-compiler');
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

      const result = compileBucketTile({
        renderTile,
        tile,
        tileProjection,
      });

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('fill');
    });

    it('should create line bucket for line batch', async () => {
      const { compileBucketTile } = await import('../../../src/mvt/worker/bucket-tile-compiler');
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
      const tile = createMockParsedTile() as unknown as ParsedTile;

      const result = compileBucketTile({
        renderTile,
        tile,
        tileProjection,
      });

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('line');
    });

    it('should create circle bucket for circle batch', async () => {
      const { compileBucketTile } = await import('../../../src/mvt/worker/bucket-tile-compiler');
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
      const tile = createMockParsedTile() as unknown as ParsedTile;

      const result = compileBucketTile({
        renderTile,
        tile,
        tileProjection,
      });

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].type).toBe('circle');
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

function createMockParsedTile() {
  return {
    layers: {
      layer: {
        extent: 4096,
        length: 1,
        feature: () => ({
          type: 3,
          id: 1,
          properties: { name: 'test' },
          loadGeometry: () => [[
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
            { x: 0, y: 0 },
          ]],
        }),
      },
    },
  };
}
