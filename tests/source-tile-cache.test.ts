import type { TileLoader } from '../src/mvt/tile/tile-loader';
import { describe, expect, it, vi } from 'vitest';
import { SourceTileCache } from '../src/mvt/tile/source-tile-cache';

describe('source-tile-cache', () => {
  it('dedupes inflight loads and reuses cached source tiles', async () => {
    const cache = new SourceTileCache({
      maxByteLength: 1024,
      protectedFrames: 0,
    });
    cache.beginFrame(1);

    let resolveLoad!: (value: Awaited<ReturnType<TileLoader['loadTile']>>) => void;
    const loadPromise = new Promise<Awaited<ReturnType<TileLoader['loadTile']>>>((resolve) => {
      resolveLoad = resolve;
    });

    const loadTile = vi.fn<TileLoader['loadTile']>().mockReturnValue(loadPromise);
    const coordinate = { x: 10, y: 20, z: 5 };

    const firstAcquire = cache.acquire(coordinate, 'tile-a', { loadTile });
    const secondAcquire = cache.acquire(coordinate, 'tile-b', { loadTile });
    expect(loadTile).toHaveBeenCalledTimes(1);

    resolveLoad({
      arrayBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      byteLength: 4,
      url: 'https://example.com/5/10/20.pbf',
    });

    await expect(firstAcquire).resolves.toMatchObject({
      byteLength: 4,
      url: 'https://example.com/5/10/20.pbf',
    });
    await expect(secondAcquire).resolves.toMatchObject({
      byteLength: 4,
      url: 'https://example.com/5/10/20.pbf',
    });

    cache.release(coordinate, 'tile-a');
    cache.release(coordinate, 'tile-b');
    cache.beginFrame(2);

    await expect(cache.acquire(coordinate, 'tile-c', { loadTile })).resolves.toMatchObject({
      byteLength: 4,
      url: 'https://example.com/5/10/20.pbf',
    });
    expect(loadTile).toHaveBeenCalledTimes(1);
  });

  it('evicts unpinned cached source tiles when over budget', async () => {
    const cache = new SourceTileCache({
      maxByteLength: 4,
      protectedFrames: 0,
    });
    cache.beginFrame(1);

    const loadTile = vi.fn<TileLoader['loadTile']>()
      .mockResolvedValueOnce({
        arrayBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
        byteLength: 4,
        url: 'https://example.com/4/1/1.pbf',
      })
      .mockResolvedValueOnce({
        arrayBuffer: new Uint8Array([5, 6, 7, 8]).buffer,
        byteLength: 4,
        url: 'https://example.com/4/1/2.pbf',
      });

    const firstCoordinate = { x: 1, y: 1, z: 4 };
    const secondCoordinate = { x: 1, y: 2, z: 4 };

    await cache.acquire(firstCoordinate, 'tile-a', { loadTile });
    cache.release(firstCoordinate, 'tile-a');
    cache.beginFrame(2);
    await cache.acquire(secondCoordinate, 'tile-b', { loadTile });
    cache.release(secondCoordinate, 'tile-b');

    expect(cache.byteLength).toBe(8);
    cache.beginFrame(3);
    cache.evict();

    expect(cache.byteLength).toBe(4);
    expect(cache.get(firstCoordinate)).toBeUndefined();
    expect(cache.get(secondCoordinate)).toMatchObject({
      byteLength: 4,
      url: 'https://example.com/4/1/2.pbf',
    });
  });
});
