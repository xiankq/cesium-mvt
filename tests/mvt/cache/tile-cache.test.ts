import { describe, expect, it } from 'vitest';
import { calculateDynamicCacheSize, TileCache } from '@/mvt/cache/tile-cache';

describe('tileCache LRU mechanism', () => {
  it('should evict least recently used tiles when cache is full', () => {
    const cache = new TileCache({
      maxBytes: 1000,
    });

    cache.add('tile1', { byteLength: 400 });
    cache.add('tile2', { byteLength: 400 });
    cache.add('tile3', { byteLength: 400 });

    expect(cache.has('tile1')).toBe(false);
    expect(cache.has('tile2')).toBe(true);
    expect(cache.has('tile3')).toBe(true);
    expect(cache.getCurrentBytes()).toBe(800);
  });

  it('should update LRU order when tile is accessed', () => {
    const cache = new TileCache({
      maxBytes: 1000,
    });

    cache.add('tile1', { byteLength: 400 });
    cache.add('tile2', { byteLength: 400 });

    cache.touch('tile1');

    cache.add('tile3', { byteLength: 400 });

    expect(cache.has('tile1')).toBe(true);
    expect(cache.has('tile2')).toBe(false);
    expect(cache.has('tile3')).toBe(true);
  });

  it('should calculate cache size dynamically based on viewport', () => {
    const viewportSize = {
      width: 1920,
      height: 1080,
      tileSize: 512,
    };

    const cacheSize = calculateDynamicCacheSize(viewportSize);

    expect(cacheSize).toBeGreaterThan(0);
    expect(cacheSize).toBeLessThan(100 * 1024 * 1024);
  });
});
