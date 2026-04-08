import { describe, expect, it } from 'vitest';
import {
  arePointsEqual,
  clonePoint,
  clonePoints,
  createPoint,
} from '../src/mvt/utils/mvt-point-utils';

describe('mvt-point-utils', () => {
  describe('createPoint', () => {
    it('creates a point with given coordinates', () => {
      const point = createPoint(10, 20);
      expect(point.x).toBe(10);
      expect(point.y).toBe(20);
    });

    it('creates a point with zero coordinates', () => {
      const point = createPoint(0, 0);
      expect(point.x).toBe(0);
      expect(point.y).toBe(0);
    });

    it('creates a point with negative coordinates', () => {
      const point = createPoint(-5, -10);
      expect(point.x).toBe(-5);
      expect(point.y).toBe(-10);
    });
  });

  describe('clonePoint', () => {
    it('clones a point with same coordinates', () => {
      const original = createPoint(10, 20);
      const cloned = clonePoint(original);
      expect(cloned.x).toBe(10);
      expect(cloned.y).toBe(20);
    });

    it('creates a new object', () => {
      const original = createPoint(10, 20);
      const cloned = clonePoint(original);
      expect(cloned).not.toBe(original);
    });
  });

  describe('clonePoints', () => {
    it('clones an array of points', () => {
      const points = [createPoint(1, 2), createPoint(3, 4), createPoint(5, 6)];
      const cloned = clonePoints(points);
      expect(cloned).toHaveLength(3);
      expect(cloned[0].x).toBe(1);
      expect(cloned[1].y).toBe(4);
    });

    it('creates new array and objects', () => {
      const points = [createPoint(1, 2)];
      const cloned = clonePoints(points);
      expect(cloned).not.toBe(points);
      expect(cloned[0]).not.toBe(points[0]);
    });

    it('handles empty array', () => {
      const cloned = clonePoints([]);
      expect(cloned).toHaveLength(0);
    });
  });

  describe('arePointsEqual', () => {
    it('returns true for equal points', () => {
      const p1 = createPoint(10, 20);
      const p2 = createPoint(10, 20);
      expect(arePointsEqual(p1, p2)).toBe(true);
    });

    it('returns false for different x coordinates', () => {
      const p1 = createPoint(10, 20);
      const p2 = createPoint(15, 20);
      expect(arePointsEqual(p1, p2)).toBe(false);
    });

    it('returns false for different y coordinates', () => {
      const p1 = createPoint(10, 20);
      const p2 = createPoint(10, 25);
      expect(arePointsEqual(p1, p2)).toBe(false);
    });

    it('returns true for same point', () => {
      const p = createPoint(10, 20);
      expect(arePointsEqual(p, p)).toBe(true);
    });
  });
});
