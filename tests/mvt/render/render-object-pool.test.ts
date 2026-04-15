import { describe, expect, it } from 'vitest';
import { RenderObjectPool } from '@/mvt/render/render-object-pool';

describe('render-object-pool', () => {
  describe('renderObjectPool', () => {
    it('should reuse objects from pool', () => {
      const pool = new RenderObjectPool<{ id: number }>({
        create: () => ({ id: 0 }),
        reset: (obj) => {
          obj.id = 0;
        },
      });

      const obj1 = pool.acquire();
      obj1.id = 1;
      pool.release(obj1);

      const obj2 = pool.acquire();
      expect(obj2.id).toBe(0);
    });

    it('should create new objects when pool is empty', () => {
      let createCount = 0;
      const pool = new RenderObjectPool<{ id: number }>({
        create: () => ({ id: createCount++ }),
        reset: (obj) => {
          obj.id = 0;
        },
      });

      pool.acquire();
      pool.acquire();

      expect(createCount).toBe(2);
    });

    it('should limit pool size', () => {
      const pool = new RenderObjectPool<{ id: number }>({
        create: () => ({ id: 0 }),
        reset: (obj) => {
          obj.id = 0;
        },
        maxSize: 2,
      });

      pool.release(pool.acquire());
      pool.release(pool.acquire());
      pool.release(pool.acquire());

      expect(pool.size()).toBe(2);
    });

    it('should clear pool', () => {
      const pool = new RenderObjectPool<{ id: number }>({
        create: () => ({ id: 0 }),
        reset: (obj) => {
          obj.id = 0;
        },
      });

      const obj = pool.acquire();
      pool.release(obj);

      pool.clear();

      expect(pool.size()).toBe(0);
    });
  });
});
