import { describe, expect, it } from 'vitest';

describe('line-subdivision', () => {
  describe('subdivideLine', () => {
    it('should subdivide line based on chord error', async () => {
      const { subdivideLine } = await import('@/mvt/geometry/line-subdivision');
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
      const { subdivideLine } = await import('@/mvt/geometry/line-subdivision');
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
      const { subdivideLine } = await import('@/mvt/geometry/line-subdivision');
      const { Cartesian3 } = await import('cesium');

      const start = new Cartesian3(6378137, 0, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, start, maxChordError);

      expect(subdivided.length).toBe(1);
      expect(subdivided[0]).toEqual(start);
    });

    it('should produce points on ellipsoid surface', async () => {
      const { subdivideLine } = await import('@/mvt/geometry/line-subdivision');
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

    it('should preserve height offset in subdivided points', async () => {
      const { subdivideLine } = await import('@/mvt/geometry/line-subdivision');
      const { Cartesian3, Ellipsoid } = await import('cesium');

      const heightOffset = 100;
      const ellipsoidRadius = Ellipsoid.WGS84.maximumRadius;
      const expectedRadius = ellipsoidRadius + heightOffset;

      const start = new Cartesian3(expectedRadius, 0, 0);
      const end = new Cartesian3(0, expectedRadius, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, end, maxChordError);

      expect(subdivided.length).toBeGreaterThan(2);

      for (const point of subdivided) {
        const magnitude = Cartesian3.magnitude(point);
        expect(Math.abs(magnitude - expectedRadius)).toBeLessThan(1);
      }
    });

    it('should interpolate height offset between start and end', async () => {
      const { subdivideLine } = await import('@/mvt/geometry/line-subdivision');
      const { Cartesian3, Ellipsoid } = await import('cesium');

      const startHeight = 100;
      const endHeight = 200;
      const ellipsoidRadius = Ellipsoid.WGS84.maximumRadius;

      const start = new Cartesian3(ellipsoidRadius + startHeight, 0, 0);
      const end = new Cartesian3(0, ellipsoidRadius + endHeight, 0);
      const maxChordError = 10;

      const subdivided = subdivideLine(start, end, maxChordError);

      expect(subdivided.length).toBeGreaterThan(2);

      const startMagnitude = Cartesian3.magnitude(start);
      const endMagnitude = Cartesian3.magnitude(end);

      expect(Cartesian3.magnitude(subdivided[0])).toBeCloseTo(startMagnitude, 0);
      expect(Cartesian3.magnitude(subdivided[subdivided.length - 1])).toBeCloseTo(endMagnitude, 0);

      for (let i = 1; i < subdivided.length - 1; i++) {
        const magnitude = Cartesian3.magnitude(subdivided[i]);
        expect(magnitude).toBeGreaterThanOrEqual(Math.min(startMagnitude, endMagnitude) - 1);
        expect(magnitude).toBeLessThanOrEqual(Math.max(startMagnitude, endMagnitude) + 1);
      }
    });
  });

  describe('subdivideRing', () => {
    it('should subdivide closed ring', async () => {
      const { subdivideRing } = await import('@/mvt/geometry/line-subdivision');
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
