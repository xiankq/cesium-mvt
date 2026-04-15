import { describe, expect, it } from 'vitest';
import { MaterialPool } from '@/mvt/render/material-pool';

describe('material-pool', () => {
  describe('materialPool', () => {
    it('should reuse materials with same key', () => {
      const pool = new MaterialPool();

      const material1 = pool.acquire('color-red', () => ({ color: 'red' }));
      const material2 = pool.acquire('color-red', () => ({ color: 'red' }));

      expect(material1).toBe(material2);
    });

    it('should create different materials for different keys', () => {
      const pool = new MaterialPool();

      const material1 = pool.acquire('color-red', () => ({ color: 'red' }));
      const material2 = pool.acquire('color-blue', () => ({ color: 'blue' }));

      expect(material1).not.toBe(material2);
    });

    it('should track reference count', () => {
      const pool = new MaterialPool();

      pool.acquire('color-red', () => ({ color: 'red' }));
      pool.acquire('color-red', () => ({ color: 'red' }));

      expect(pool.getReferenceCount('color-red')).toBe(2);
    });

    it('should release materials', () => {
      const pool = new MaterialPool();

      pool.acquire('color-red', () => ({ color: 'red' }));
      pool.acquire('color-red', () => ({ color: 'red' }));
      pool.release('color-red');

      expect(pool.getReferenceCount('color-red')).toBe(1);
    });

    it('should remove material when reference count reaches zero', () => {
      const pool = new MaterialPool();

      pool.acquire('color-red', () => ({ color: 'red' }));
      pool.release('color-red');

      expect(pool.has('color-red')).toBe(false);
    });
  });
});
