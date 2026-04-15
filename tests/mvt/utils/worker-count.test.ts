import { describe, expect, it, vi } from 'vitest';
import { computeOptimalWorkerCount } from '@/mvt/utils/worker-count';

describe('worker-count', () => {
  describe('computeOptimalWorkerCount', () => {
    it('should return minimum 2 workers when hardwareConcurrency is 1', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 1,
      });

      const count = computeOptimalWorkerCount();

      expect(count).toBe(2);
    });

    it('should return 4 workers when hardwareConcurrency is 4', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 4,
      });

      const count = computeOptimalWorkerCount();

      expect(count).toBe(4);
    });

    it('should return 8 workers when hardwareConcurrency is 16', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 16,
      });

      const count = computeOptimalWorkerCount();

      expect(count).toBe(8);
    });

    it('should return default 4 workers when hardwareConcurrency is not available', () => {
      vi.stubGlobal('navigator', {});

      const count = computeOptimalWorkerCount();

      expect(count).toBe(4);
    });

    it('should respect custom min and max', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 16,
      });

      const count = computeOptimalWorkerCount({ minWorkers: 4, maxWorkers: 12 });

      expect(count).toBe(12);
    });
  });
});
