import type { ParsedTileResult } from '@/mvt/bucket';
import { describe, expect, it, vi } from 'vitest';
import { TileCacheManager } from '@/mvt/source/tile-cache-manager';

describe('tile-cache-manager', () => {
  it('应该统计 cache hit miss 和 eviction', () => {
    const manager = new TileCacheManager({
      maxBytes: 3,
    });

    expect(manager.get('missing')).toBeUndefined();

    manager.set('tile/1', createTile('tile/1'));
    expect(manager.get('tile/1')).toMatchObject({
      byteLength: 3,
      key: 'tile/1',
    });

    manager.set('tile/2', createTile('tile/2'));

    expect(manager.getMetrics()).toMatchObject({
      currentBytes: 3,
      entryCount: 1,
      evictCount: 1,
      hitCount: 1,
      maxBytes: 3,
      maximumCacheOverflowBytes: 0,
      missCount: 1,
    });
  });

  it('应该允许可见瓦片使用 overflow 预算', () => {
    const manager = new TileCacheManager({
      maxBytes: 6,
      maximumCacheOverflowBytes: 3,
    });
    const onEvict = vi.fn();
    manager.setOnEvict(onEvict);

    manager.set('tile/1', createTile('tile/1'));
    manager.set('tile/2', createTile('tile/2'));
    manager.set('tile/3', createTile('tile/3'));

    expect(manager.getMetrics()).toMatchObject({
      entryCount: 3,
      evictCount: 0,
      hitCount: 0,
      missCount: 0,
    });

    manager.set('tile/4', createTile('tile/4'));

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('tile/1', expect.objectContaining({
      key: 'tile/1',
    }));
    expect(manager.getMetrics()).toMatchObject({
      entryCount: 3,
      evictCount: 1,
      hitCount: 0,
      missCount: 0,
    });
  });

  it('应该暴露当前缓存字节压力', () => {
    const manager = new TileCacheManager({
      maxBytes: 6,
    });

    manager.set('tile/1', createTile('tile/1'));

    expect(manager.getMetrics()).toMatchObject({
      currentBytes: 3,
      entryCount: 1,
    });
  });
});

function createTile(key: string) {
  return {
    buckets: [],
    byteLength: 3,
    epoch: 1,
    key,
  } as ParsedTileResult;
}
