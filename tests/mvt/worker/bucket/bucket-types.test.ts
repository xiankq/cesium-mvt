import { describe, expect, it } from 'vitest';
import {
  calculateBucketByteLength,
  calculateFeatureIndexByteLength,
} from '@/mvt/worker/bucket/bucket-types';

describe('bucket-types', () => {
  describe('calculateBucketByteLength', () => {
    it('should calculate byte length for fill bucket stats', () => {
      const stats = {
        type: 'fill' as const,
        featureCount: 10,
        byteLength: 0,
        vertexCount: 100,
        triangleCount: 50,
        holeCount: 5,
        polygonCount: 10,
      };

      const byteLength = calculateBucketByteLength(stats);

      expect(byteLength).toBe(100 * 3 * 8 + 50 * 3 * 4 + 5 * 4 + 100 * 4);
    });

    it('should calculate byte length for line bucket stats', () => {
      const stats = {
        type: 'line' as const,
        featureCount: 5,
        byteLength: 0,
        polylineCount: 10,
        totalVertexCount: 100,
      };

      const byteLength = calculateBucketByteLength(stats);

      expect(byteLength).toBe(100 * 3 * 8 + 10 * 4 + 10 * 4);
    });

    it('should calculate byte length for circle bucket stats', () => {
      const stats = {
        type: 'circle' as const,
        featureCount: 20,
        byteLength: 0,
        pointCount: 20,
      };

      const byteLength = calculateBucketByteLength(stats);

      expect(byteLength).toBe(20 * 3 * 8 + 20 * 4);
    });
  });

  describe('calculateFeatureIndexByteLength', () => {
    it('should calculate byte length for feature index', () => {
      const entryCount = 10;
      const byteLength = calculateFeatureIndexByteLength(entryCount);

      expect(byteLength).toBe(10 * 200);
    });
  });
});
