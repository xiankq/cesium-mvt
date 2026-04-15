import { describe, expect, it } from 'vitest';
import { computeScreenSpaceError } from '@/mvt/source/tile-sse';

describe('tile-sse', () => {
  describe('computeScreenSpaceError', () => {
    it('should compute SSE for a tile at given distance', () => {
      const geometricError = 100;
      const distance = 1000;
      const viewportHeight = 1080;
      const sseDenominator = 0.5;

      const sse = computeScreenSpaceError({
        geometricError,
        distance,
        viewportHeight,
        sseDenominator,
      });

      expect(sse).toBeCloseTo(216, 0);
    });

    it('should return 0 when geometric error is 0', () => {
      const sse = computeScreenSpaceError({
        geometricError: 0,
        distance: 1000,
        viewportHeight: 1080,
        sseDenominator: 0.5,
      });

      expect(sse).toBe(0);
    });

    it('should increase SSE when distance decreases', () => {
      const geometricError = 100;
      const viewportHeight = 1080;
      const sseDenominator = 0.5;

      const sse1 = computeScreenSpaceError({
        geometricError,
        distance: 1000,
        viewportHeight,
        sseDenominator,
      });

      const sse2 = computeScreenSpaceError({
        geometricError,
        distance: 500,
        viewportHeight,
        sseDenominator,
      });

      expect(sse2).toBeGreaterThan(sse1);
    });

    it('should increase SSE when geometric error increases', () => {
      const distance = 1000;
      const viewportHeight = 1080;
      const sseDenominator = 0.5;

      const sse1 = computeScreenSpaceError({
        geometricError: 100,
        distance,
        viewportHeight,
        sseDenominator,
      });

      const sse2 = computeScreenSpaceError({
        geometricError: 200,
        distance,
        viewportHeight,
        sseDenominator,
      });

      expect(sse2).toBeGreaterThan(sse1);
    });

    it('should use default SSE denominator when not provided', () => {
      const sse = computeScreenSpaceError({
        geometricError: 100,
        distance: 1000,
        viewportHeight: 1080,
      });

      expect(sse).toBeCloseTo(216, 0);
    });
  });
});
