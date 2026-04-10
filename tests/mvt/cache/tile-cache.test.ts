import type { EvictedCacheEntry } from '@/mvt/cache/tile-cache';
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

describe('tileCache add returns evicted entries', () => {
  it('returns empty array when no eviction happens', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    const evicted = cache.add('tile1', { byteLength: 400 });
    expect(evicted).toEqual([]);
  });

  it('returns evicted entries when cache overflows', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    cache.add('tile1', { byteLength: 400 });
    cache.add('tile2', { byteLength: 400 });

    const evicted = cache.add('tile3', { byteLength: 400 });

    expect(evicted).toHaveLength(1);
    expect(evicted[0].key).toBe('tile1');
    expect(evicted[0].entry.byteLength).toBe(400);
  });

  it('returns multiple evicted entries in LRU order', () => {
    const cache = new TileCache({ maxBytes: 1500 });
    cache.add('tile1', { byteLength: 500 });
    cache.add('tile2', { byteLength: 500 });

    // tile3 needs to be large enough to evict both tile1 and tile2:
    // currentBytes=1000, adding tile3(1200): 1000+1200=2200 > 1500
    // evict tile1(500) → currentBytes=500, 500+1200=1700 > 1500
    // evict tile2(500) → currentBytes=0, 0+1200=1200 <= 1500 ✓
    const evicted = cache.add('tile3', { byteLength: 1200 });

    expect(evicted).toHaveLength(2);
    expect(evicted[0].key).toBe('tile1');
    expect(evicted[1].key).toBe('tile2');
  });
});

describe('tileCache delete', () => {
  it('returns the deleted entry', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    cache.add('tile1', { byteLength: 400 });

    const deleted = cache.delete('tile1');

    expect(deleted).toBeDefined();
    expect(deleted!.byteLength).toBe(400);
    expect(cache.has('tile1')).toBe(false);
    expect(cache.getCurrentBytes()).toBe(0);
  });

  it('returns undefined when key does not exist', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    const deleted = cache.delete('nonexistent');
    expect(deleted).toBeUndefined();
  });

  it('correctly updates LRU list after delete', () => {
    const cache = new TileCache({ maxBytes: 2000 });
    cache.add('tile1', { byteLength: 400 });
    cache.add('tile2', { byteLength: 400 });
    cache.add('tile3', { byteLength: 400 });
    // After adding tile3: tile1 was evicted (400+400+400=1200 > 2000? No, 1200 <= 2000)
    // Actually all three fit: 400*3=1200 <= 2000, so tile1 is still here.

    cache.delete('tile2');

    expect(cache.has('tile1')).toBe(true);
    expect(cache.has('tile2')).toBe(false);
    expect(cache.has('tile3')).toBe(true);
    expect(cache.getCurrentBytes()).toBe(800);
  });

  it('correctly handles deleting the only item', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    cache.add('tile1', { byteLength: 400 });

    cache.delete('tile1');

    expect(cache.getCurrentBytes()).toBe(0);
    expect(cache.has('tile1')).toBe(false);
  });
});

describe('tileCache clear', () => {
  it('returns all entries as evicted', () => {
    const cache = new TileCache({ maxBytes: 2000 });
    cache.add('tile1', { byteLength: 400 });
    cache.add('tile2', { byteLength: 500 });

    const evicted = cache.clear();

    expect(evicted).toHaveLength(2);
    const keys = evicted.map((e: EvictedCacheEntry) => e.key);
    expect(keys).toContain('tile1');
    expect(keys).toContain('tile2');
  });

  it('resets cache to empty state', () => {
    const cache = new TileCache({ maxBytes: 2000 });
    cache.add('tile1', { byteLength: 400 });
    cache.add('tile2', { byteLength: 500 });

    cache.clear();

    expect(cache.getCurrentBytes()).toBe(0);
    expect(cache.has('tile1')).toBe(false);
    expect(cache.has('tile2')).toBe(false);
  });

  it('returns empty array when clearing an empty cache', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    const evicted = cache.clear();
    expect(evicted).toEqual([]);
  });
});

describe('tileCache touch edge cases', () => {
  it('does nothing when touching a nonexistent key', () => {
    const cache = new TileCache({ maxBytes: 1000 });
    cache.touch('nonexistent');
    expect(cache.getCurrentBytes()).toBe(0);
  });

  it('moves touched item to MRU position', () => {
    const cache = new TileCache({ maxBytes: 1500 });
    cache.add('tile1', { byteLength: 500 });
    cache.add('tile2', { byteLength: 500 });
    cache.add('tile3', { byteLength: 500 });

    cache.touch('tile1');
    cache.add('tile4', { byteLength: 500 });

    expect(cache.has('tile1')).toBe(true);
    expect(cache.has('tile2')).toBe(false);
  });
});

describe('tileCache add replaces existing key', () => {
  it('updates byteLength when re-adding the same key', () => {
    const cache = new TileCache({ maxBytes: 2000 });
    cache.add('tile1', { byteLength: 400 });
    cache.add('tile1', { byteLength: 600 });

    expect(cache.getCurrentBytes()).toBe(600);
    expect(cache.has('tile1')).toBe(true);
  });
});
