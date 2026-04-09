import { describe, expect, it } from 'vitest';
import { MvtTile } from '../src/mvt/tile/tile';
import { TileCache } from '../src/mvt/tile/tile-cache';
import { TileQueue } from '../src/mvt/tile/tile-queue';
import { TileStore } from '../src/mvt/tile/tile-store';

describe('tile-scheduling', () => {
  it('pops higher priority tiles first', () => {
    const queue = new TileQueue();
    const lowPriorityTile = new MvtTile({ x: 0, y: 0, z: 0 });
    const highPriorityTile = new MvtTile({ x: 1, y: 1, z: 1 });

    queue.upsert(lowPriorityTile, 1);
    queue.upsert(highPriorityTile, 10);

    expect(queue.popNext()?.key).toBe(highPriorityTile.key);
    expect(queue.popNext()?.key).toBe(lowPriorityTile.key);
  });

  it('keeps only the latest queued priority for the same tile', () => {
    const queue = new TileQueue();
    const tile = new MvtTile({ x: 3, y: 2, z: 1 });

    queue.upsert(tile, 1);
    queue.upsert(tile, 10);

    expect(queue.popNext()?.key).toBe(tile.key);
    expect(queue.popNext()).toBeUndefined();
  });

  it('evicts least recently used non-protected tiles when cache exceeds budget', () => {
    const cache = new TileCache({
      byteLengthSelector: tile => tile.cpuByteLength,
      maxByteLength: 9,
      protectedFrames: 1,
    });

    const tileA = new MvtTile({ x: 0, y: 0, z: 0 });
    tileA.touch(1);
    tileA.setByteLength({ cpu: 4 });
    const tileB = new MvtTile({ x: 1, y: 0, z: 0 });
    tileB.touch(1);
    tileB.setByteLength({ cpu: 4 });
    const tileC = new MvtTile({ x: 2, y: 0, z: 0 });
    tileC.touch(2);
    tileC.setByteLength({ cpu: 4 });

    cache.track(tileA);
    cache.track(tileB);
    cache.track(tileC);

    expect(cache.totalByteLength).toBe(12);
    expect(cache.evict(4).map(tile => tile.key)).toEqual([tileA.key]);
  });

  it('tracks load and upload queues through tile store', () => {
    const tileStore = new TileStore({
      maxCpuCacheBytes: 128,
      maxGpuCacheBytes: 128,
      protectedFrames: 0,
    });

    tileStore.beginFrame(5);
    const tile = tileStore.touchTile({ x: 5, y: 10, z: 4 }, 3);

    tileStore.queueLoad(tile, 5);
    tileStore.queueParse(tile, 4);
    tileStore.queueUpload(tile, 2);
    tileStore.updateTileByteLength(tile, { cpu: 64, gpu: 32 });

    expect(tileStore.loadingQueueSize).toBe(1);
    expect(tileStore.parseQueueSize).toBe(1);
    expect(tileStore.uploadQueueSize).toBe(1);
    expect(tileStore.cpuCacheBytes).toBe(64);
    expect(tileStore.gpuCacheBytes).toBe(32);
    expect(tileStore.dequeueLoad()?.key).toBe(tile.key);
    expect(tileStore.dequeueParse()?.key).toBe(tile.key);
    expect(tileStore.dequeueUpload()?.key).toBe(tile.key);
  });
});
