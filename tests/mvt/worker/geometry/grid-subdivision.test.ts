import { describe, expect, it } from 'vitest';

describe('grid-subdivision', () => {
  describe('subdivideTriangleEdges', () => {
    it('should return empty result for empty input', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges([], [], 128, projectPoint);

      expect(result.positions).toHaveLength(0);
      expect(result.triangles).toHaveLength(0);
    });

    it('should not subdivide small triangles', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const tilePoints = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 150, y: 200 },
      ];
      const triangles = [0, 1, 2];
      const granularity = 4;

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges(tilePoints, triangles, granularity, projectPoint);

      expect(result.positions).toHaveLength(3);
      expect(result.triangles).toHaveLength(3);
    });

    it('should subdivide large triangles recursively', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const tilePoints = [
        { x: 0, y: 0 },
        { x: 4096, y: 0 },
        { x: 2048, y: 4096 },
      ];
      const triangles = [0, 1, 2];
      const granularity = 16;

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges(tilePoints, triangles, granularity, projectPoint);

      expect(result.positions.length).toBeGreaterThan(3);
      expect(result.triangles.length).toBeGreaterThan(3);
      expect(result.triangles.length % 3).toBe(0);
    });

    it('should produce valid triangle indices', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const tilePoints = [
        { x: 0, y: 0 },
        { x: 4096, y: 0 },
        { x: 2048, y: 4096 },
      ];
      const triangles = [0, 1, 2];
      const granularity = 32;

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges(tilePoints, triangles, granularity, projectPoint);

      const maxIndex = Math.max(...result.triangles);
      expect(maxIndex).toBeLessThan(result.positions.length);

      for (const index of result.triangles) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(result.positions.length);
      }
    });

    it('should handle multiple triangles', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const tilePoints = [
        { x: 0, y: 0 },
        { x: 2048, y: 0 },
        { x: 1024, y: 2048 },
        { x: 2048, y: 0 },
        { x: 4096, y: 0 },
        { x: 3072, y: 2048 },
      ];
      const triangles = [0, 1, 2, 3, 4, 5];
      const granularity = 32;

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges(tilePoints, triangles, granularity, projectPoint);

      expect(result.triangles.length % 3).toBe(0);
    });

    it('should snap boundary points', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const tilePoints = [
        { x: 0.1, y: 0.1 },
        { x: 4095.9, y: 0.1 },
        { x: 2048, y: 4095.9 },
      ];
      const triangles = [0, 1, 2];
      const granularity = 128;

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges(tilePoints, triangles, granularity, projectPoint);

      expect(result.positions.length).toBeGreaterThan(0);

      const hasBoundaryPoint = result.positions.some(
        p => (Math.abs(p.x) < 1 && Math.abs(p.y) < 1)
          || (Math.abs(p.x - 4096) < 1 && Math.abs(p.y) < 1)
          || (Math.abs(p.x - 2048) < 1 && Math.abs(p.y - 4096) < 1),
      );
      expect(hasBoundaryPoint).toBe(true);
    });

    it('should deduplicate vertices at same position', async () => {
      const { subdivideTriangleEdges } = await import('@/mvt/worker/geometry/grid-subdivision');
      const { Cartesian3 } = await import('cesium');

      const tilePoints = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      const triangles = [0, 1, 2, 0, 2, 3];
      const granularity = 4;

      const projectPoint = (point: { x: number; y: number }) => new Cartesian3(point.x, point.y, 0);

      const result = subdivideTriangleEdges(tilePoints, triangles, granularity, projectPoint);

      const uniquePositions = new Set<string>();
      for (const pos of result.positions) {
        const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)}`;
        uniquePositions.add(key);
      }

      expect(uniquePositions.size).toBe(result.positions.length);
    });
  });

  describe('getGranularityForZoomLevel', () => {
    it('should return base granularity for zoom 0', async () => {
      const { getGranularityForZoomLevel } = await import('@/mvt/worker/geometry/grid-subdivision');

      const granularity = getGranularityForZoomLevel(0);

      expect(granularity).toBe(128);
    });

    it('should decrease granularity with higher zoom levels', async () => {
      const { getGranularityForZoomLevel } = await import('@/mvt/worker/geometry/grid-subdivision');

      const granularity0 = getGranularityForZoomLevel(0);
      const granularity1 = getGranularityForZoomLevel(1);
      const granularity2 = getGranularityForZoomLevel(2);

      expect(granularity1).toBeLessThan(granularity0);
      expect(granularity2).toBeLessThan(granularity1);
    });

    it('should respect minimum granularity', async () => {
      const { getGranularityForZoomLevel } = await import('@/mvt/worker/geometry/grid-subdivision');

      const granularity = getGranularityForZoomLevel(10, 128, 16);

      expect(granularity).toBe(16);
    });

    it('should use custom base granularity', async () => {
      const { getGranularityForZoomLevel } = await import('@/mvt/worker/geometry/grid-subdivision');

      const granularity = getGranularityForZoomLevel(0, 256);

      expect(granularity).toBe(256);
    });

    it('should not reach minimum granularity too early', async () => {
      const { getGranularityForZoomLevel } = await import('@/mvt/worker/geometry/grid-subdivision');

      const granularity3 = getGranularityForZoomLevel(3);
      const granularity4 = getGranularityForZoomLevel(4);
      const granularity5 = getGranularityForZoomLevel(5);

      expect(granularity3).toBe(16);
      expect(granularity4).toBe(8);
      expect(granularity5).toBe(4);
    });

    it('should follow MapLibre subdivision strategy', async () => {
      const { getGranularityForZoomLevel } = await import('@/mvt/worker/geometry/grid-subdivision');

      expect(getGranularityForZoomLevel(0)).toBe(128);
      expect(getGranularityForZoomLevel(1)).toBe(64);
      expect(getGranularityForZoomLevel(2)).toBe(32);
      expect(getGranularityForZoomLevel(3)).toBe(16);
      expect(getGranularityForZoomLevel(4)).toBe(8);
      expect(getGranularityForZoomLevel(5)).toBe(4);
      expect(getGranularityForZoomLevel(6)).toBe(2);
      expect(getGranularityForZoomLevel(7)).toBe(1);
      expect(getGranularityForZoomLevel(8)).toBe(1);
      expect(getGranularityForZoomLevel(12)).toBe(1);
    });
  });

  describe('getGridCellSize', () => {
    it('should calculate correct cell size', async () => {
      const { getGridCellSize } = await import('@/mvt/worker/geometry/grid-subdivision');

      const cellSize = getGridCellSize(128);

      expect(cellSize).toBe(4096 / 128);
    });

    it('should return smaller cell size for higher granularity', async () => {
      const { getGridCellSize } = await import('@/mvt/worker/geometry/grid-subdivision');

      const cellSize64 = getGridCellSize(64);
      const cellSize128 = getGridCellSize(128);

      expect(cellSize128).toBeLessThan(cellSize64);
    });
  });
});
