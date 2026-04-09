import { describe, expect, it } from 'vitest';
import { distanceBetweenPoints, interpolateHorizontalIntersection, interpolatePoint, interpolateVerticalIntersection } from '../src/mvt/utils/mvt-geometry-utils';
import { createPoint } from '../src/mvt/utils/mvt-point-utils';

describe('mvt-geometry-utils', () => {
  describe('interpolatePoint', () => {
    it('interpolates at start when ratio is 0', () => {
      const start = createPoint(0, 0);
      const end = createPoint(10, 20);
      const result = interpolatePoint(start, end, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('interpolates at end when ratio is 1', () => {
      const start = createPoint(0, 0);
      const end = createPoint(10, 20);
      const result = interpolatePoint(start, end, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
    });

    it('interpolates at midpoint when ratio is 0.5', () => {
      const start = createPoint(0, 0);
      const end = createPoint(10, 20);
      const result = interpolatePoint(start, end, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
    });

    it('handles negative coordinates', () => {
      const start = createPoint(-10, -20);
      const end = createPoint(10, 20);
      const result = interpolatePoint(start, end, 0.5);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('interpolateHorizontalIntersection', () => {
    it('finds intersection with horizontal line', () => {
      const start = createPoint(0, 0);
      const end = createPoint(10, 10);
      const result = interpolateHorizontalIntersection(start, end, 5);
      expect(result.y).toBe(5);
      expect(result.x).toBe(5);
    });

    it('returns start point when y values are equal', () => {
      const start = createPoint(0, 5);
      const end = createPoint(10, 5);
      const result = interpolateHorizontalIntersection(start, end, 5);
      expect(result.y).toBe(5);
    });
  });

  describe('interpolateVerticalIntersection', () => {
    it('finds intersection with vertical line', () => {
      const start = createPoint(0, 0);
      const end = createPoint(10, 10);
      const result = interpolateVerticalIntersection(start, end, 5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('returns start point when x values are equal', () => {
      const start = createPoint(5, 0);
      const end = createPoint(5, 10);
      const result = interpolateVerticalIntersection(start, end, 5);
      expect(result.x).toBe(5);
    });
  });

  describe('distanceBetweenPoints', () => {
    it('calculates distance between two points', () => {
      const start = createPoint(0, 0);
      const end = createPoint(3, 4);
      expect(distanceBetweenPoints(start, end)).toBe(5);
    });

    it('returns 0 for same point', () => {
      const point = createPoint(10, 20);
      expect(distanceBetweenPoints(point, point)).toBe(0);
    });

    it('handles negative coordinates', () => {
      const start = createPoint(-3, 0);
      const end = createPoint(0, 4);
      expect(distanceBetweenPoints(start, end)).toBe(5);
    });
  });
});
