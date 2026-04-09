import { describe, expect, it } from 'vitest';
import { clamp, lerp } from '../src/mvt/utils/math-utils';

describe('math-utils', () => {
  describe('clamp', () => {
    it('returns value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('returns min when value is below range', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('returns max when value is above range', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('handles equal min and max', () => {
      expect(clamp(5, 10, 10)).toBe(10);
    });

    it('handles negative range', () => {
      expect(clamp(-5, -10, -1)).toBe(-5);
    });
  });

  describe('lerp', () => {
    it('returns start when t is 0', () => {
      expect(lerp(0, 10, 0)).toBe(0);
    });

    it('returns end when t is 1', () => {
      expect(lerp(0, 10, 1)).toBe(10);
    });

    it('returns midpoint when t is 0.5', () => {
      expect(lerp(0, 10, 0.5)).toBe(5);
    });

    it('handles negative values', () => {
      expect(lerp(-10, 10, 0.5)).toBe(0);
    });

    it('handles t outside 0-1 range', () => {
      expect(lerp(0, 10, 2)).toBe(20);
      expect(lerp(0, 10, -1)).toBe(-10);
    });
  });
});
