import { describe, expect, it } from 'vitest';

describe('line-subdivision', () => {
  describe('subdivideLine', () => {
    it('should subdivide line based on chord error', async () => {
      const { subdivideLine } = await import('@/mvt/worker/geometry/line-subdivision');
      const { Cartesian3 } = await import('cesium');

      const start = new Cartesian3(6378137, 0, 0);
      const end = new Cartesian3(0, 6378137, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, end, maxChordError);

      expect(subdivided.length).toBeGreaterThan(2);
      expect(subdivided[0]).toEqual(start);
      expect(subdivided[subdivided.length - 1]).toEqual(end);
    });

    it('should not subdivide short lines', async () => {
      const { subdivideLine } = await import('@/mvt/worker/geometry/line-subdivision');
      const { Cartesian3 } = await import('cesium');

      const start = new Cartesian3(6378137, 0, 0);
      const end = new Cartesian3(6378137, 10, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, end, maxChordError);

      expect(subdivided.length).toBe(2);
      expect(subdivided[0]).toEqual(start);
      expect(subdivided[1]).toEqual(end);
    });

    it('should handle zero-length lines', async () => {
      const { subdivideLine } = await import('@/mvt/worker/geometry/line-subdivision');
      const { Cartesian3 } = await import('cesium');

      const start = new Cartesian3(6378137, 0, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, start, maxChordError);

      expect(subdivided.length).toBe(1);
      expect(subdivided[0]).toEqual(start);
    });

    it('should produce points on ellipsoid surface', async () => {
      const { subdivideLine } = await import('@/mvt/worker/geometry/line-subdivision');
      const { Cartesian3, Ellipsoid } = await import('cesium');

      const start = new Cartesian3(6378137, 0, 0);
      const end = new Cartesian3(0, 6378137, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, end, maxChordError);

      const ellipsoidRadius = Ellipsoid.WGS84.maximumRadius;

      for (const point of subdivided) {
        const magnitude = Cartesian3.magnitude(point);
        expect(Math.abs(magnitude - ellipsoidRadius)).toBeLessThan(1);
      }
    });
  });

  describe('subdivideRing', () => {
    it('should subdivide closed ring', async () => {
      const { subdivideRing } = await import('@/mvt/worker/geometry/line-subdivision');
      const { Cartesian3 } = await import('cesium');

      const ring = [
        new Cartesian3(6378137, 0, 0),
        new Cartesian3(0, 6378137, 0),
        new Cartesian3(-6378137, 0, 0),
        new Cartesian3(0, -6378137, 0),
        new Cartesian3(6378137, 0, 0),
      ];
      const maxChordError = 10;

      const subdivided = subdivideRing(ring, maxChordError);

      expect(subdivided.length).toBeGreaterThan(ring.length);
      expect(subdivided[0]).toEqual(ring[0]);
      expect(subdivided[subdivided.length - 1]).toEqual(ring[ring.length - 1]);
    });
  });
});
