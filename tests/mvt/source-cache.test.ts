import type {
  SourceSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { TileJson } from '@/mvt/source/source-cache';
import type { TileRequest } from '@/mvt/source/tile-request';
import { describe, expect, it, vi } from 'vitest';
import { SourceCache } from '@/mvt/source/source-cache';
import { TileCacheManager } from '@/mvt/source/tile-cache-manager';
import { TileBudget } from '@/mvt/utils/tile-budget';

function createVectorSource(
  overrides: Partial<VectorSourceSpecification> = {},
): SourceSpecification {
  return {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
    ...overrides,
  };
}

describe('source-cache', () => {
  it('deduplicates in-flight tile requests and returns independent copies', async () => {
    const value = new Uint8Array([1, 2, 3]).buffer;
    const loadTile = vi.fn(async () => value);
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });
    const secondPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });

    const firstResult = (await firstPromise)!;
    const secondResult = (await secondPromise)!;

    expect(firstResult.byteLength).toBe(3);
    expect(secondResult.byteLength).toBe(3);
    expect(firstResult).not.toBe(secondResult);
    expect(loadTile).toHaveBeenCalledTimes(1);
  });

  it('销毁后不应该再启动新的瓦片请求', async () => {
    const loadTileJson = vi.fn(async () => ({
      tiles: ['./{z}/{x}/{y}.pbf'],
    } satisfies TileJson));
    const loadTile = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const sourceCache = new SourceCache({
      loadTile,
      loadTileJson,
      source: createVectorSource({
        tiles: undefined,
        url: 'https://tiles.example.com/catalog/tilejson.json',
      }),
      sourceId: 'base',
    });

    sourceCache.destroy();

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBeUndefined();

    expect(loadTileJson).not.toHaveBeenCalled();
    expect(loadTile).not.toHaveBeenCalled();
  });

  it('销毁期间完成的瓦片加载不应该写回缓存', async () => {
    let resolveTileJson: (value: TileJson) => void = () => {};
    const tileJsonPromise = new Promise<TileJson>((resolve) => {
      resolveTileJson = resolve;
    });
    let resolveTile: (value: ArrayBuffer) => void = () => {};
    const tilePromise = new Promise<ArrayBuffer>((resolve) => {
      resolveTile = resolve;
    });
    const loadTileJson = vi.fn(() => tileJsonPromise);
    const loadTile = vi.fn(() => tilePromise);
    const readyTileBudget = {
      add: vi.fn(),
      delete: vi.fn(),
      touch: vi.fn(),
    };
    const sourceCache = new SourceCache({
      loadTile,
      loadTileJson,
      readyTileBudget: readyTileBudget as any,
      source: createVectorSource({
        tiles: undefined,
        url: 'https://tiles.example.com/catalog/tilejson.json',
      }),
      sourceId: 'base',
    });

    const requestPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });

    resolveTileJson({
      tiles: ['./{z}/{x}/{y}.pbf'],
    } satisfies TileJson);

    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(loadTile).toHaveBeenCalledTimes(1);

    sourceCache.destroy();
    resolveTile(new Uint8Array([1, 2, 3]).buffer);

    await expect(requestPromise).resolves.toBeUndefined();
    expect(readyTileBudget.add).not.toHaveBeenCalled();
  });

  it('allows concurrent requests to safely transfer their ArrayBuffer copies', async () => {
    const value = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const loadTile = vi.fn(async () => value);
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });
    const secondPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });

    const firstResult = (await firstPromise)!;
    const secondResult = (await secondPromise)!;

    structuredClone(firstResult, { transfer: [firstResult] });
    expect(firstResult.byteLength).toBe(0);

    expect(() => {
      structuredClone(secondResult, { transfer: [secondResult] });
    }).not.toThrow();
    expect(secondResult.byteLength).toBe(0);
  });

  it('aborts an in-flight request and allows the tile to be requested again', async () => {
    const abortedError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const value = new Uint8Array([4, 5, 6]).buffer;
    const loadTile = vi.fn((_, signal: AbortSignal) => new Promise<ArrayBuffer>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortedError);
        return;
      }

      signal.addEventListener('abort', () => reject(abortedError), {
        once: true,
      });

      if (loadTile.mock.calls.length === 2) {
        resolve(value);
      }
    }));
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });
    sourceCache.abortTile('base/2/1/3');

    await expect(firstPromise).resolves.toBeUndefined();
    expect(sourceCache.getEntry('base/2/1/3')).toMatchObject({
      key: 'base/2/1/3',
      state: 'idle',
    });

    const retriedResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;
    expect(retriedResult).toBeInstanceOf(ArrayBuffer);
    expect(retriedResult.byteLength).toBe(3);
    expect(loadTile).toHaveBeenCalledTimes(2);
  });

  it('backs off failed tile requests before retrying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T00:00:00Z'));

    const networkError = new Error('network failed');
    const loadTile = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(new Uint8Array([4, 5, 6]).buffer);
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).rejects.toThrow('network failed');

    expect(sourceCache.getNextRetryAt()).toBe(Date.parse('2026-04-13T00:00:01Z'));

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).rejects.toMatchObject({
      name: 'RequestThrottledError',
    });

    expect(loadTile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBeInstanceOf(ArrayBuffer);

    expect(loadTile).toHaveBeenCalledTimes(2);
    expect(sourceCache.getNextRetryAt()).toBeUndefined();

    vi.useRealTimers();
  });

  it('aborts the shared tilejson request when the last tile request is cancelled', async () => {
    const abortedError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const loadTileJsonAbort = vi.fn();
    const loadTileJson = vi.fn((_, signal: AbortSignal) => new Promise<TileJson>((_, reject) => {
      if (signal.aborted) {
        loadTileJsonAbort();
        reject(abortedError);
        return;
      }

      signal.addEventListener('abort', () => {
        loadTileJsonAbort();
        reject(abortedError);
      }, {
        once: true,
      });
    }));
    const loadTile = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const sourceCache = new SourceCache({
      loadTile,
      loadTileJson,
      source: {
        type: 'vector',
        url: 'https://tiles.example.com/catalog/tilejson.json',
      } as any,
      sourceId: 'base',
    });

    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });

    sourceCache.abortTile('base/2/1/3');

    expect(loadTileJsonAbort).toHaveBeenCalledTimes(1);
    await expect(firstPromise).resolves.toBeUndefined();
    expect(sourceCache.getEntry('base/2/1/3')).toMatchObject({
      key: 'base/2/1/3',
      state: 'idle',
    });
  });

  it('loads tilejson only once and resolves relative tile templates', async () => {
    const tileValue = new Uint8Array([7, 8, 9]).buffer;
    const loadTile = vi.fn<(request: TileRequest, signal: AbortSignal) => Promise<ArrayBuffer>>(async () => tileValue as ArrayBuffer);
    const loadTileJson = vi.fn(async () => ({
      tiles: ['./{z}/{x}/{y}.pbf'],
    }));
    const sourceCache = new SourceCache({
      loadTile,
      loadTileJson,
      source: createVectorSource({
        tiles: undefined,
        url: 'https://tiles.example.com/catalog/tilejson.json',
      }),
      sourceId: 'base',
    });

    const firstResult = (await sourceCache.requestTile({
      level: 3,
      x: 4,
      y: 5,
    }))!;
    const secondResult = (await sourceCache.requestTile({
      level: 4,
      x: 5,
      y: 6,
    }))!;

    expect(firstResult).toBeInstanceOf(ArrayBuffer);
    expect(firstResult.byteLength).toBe(3);
    expect(secondResult).toBeInstanceOf(ArrayBuffer);
    expect(secondResult.byteLength).toBe(3);
    expect(firstResult).not.toBe(secondResult);

    expect(loadTileJson).toHaveBeenCalledTimes(1);
    expect(loadTile.mock.calls[0]![0]!.url).toBe(
      'https://tiles.example.com/catalog/3/4/5.pbf',
    );
    expect(loadTile.mock.calls[1]![0]!.url).toBe(
      'https://tiles.example.com/catalog/4/5/6.pbf',
    );
  });

  it('构建瓦片 URL 时优先使用 source 的 scheme 而非 tilejson 的 scheme', async () => {
    const tileValue = new Uint8Array([7, 8, 9]).buffer;
    const loadTile = vi.fn<(request: TileRequest, signal: AbortSignal) => Promise<ArrayBuffer>>(async () => tileValue as ArrayBuffer);
    const loadTileJson = vi.fn(async () => ({
      scheme: 'xyz' as const,
      tiles: ['./{z}/{x}/{y}.pbf'],
    }));
    const sourceCache = new SourceCache({
      loadTile,
      loadTileJson,
      source: createVectorSource({
        scheme: 'tms',
        tiles: undefined,
        url: 'https://tiles.example.com/catalog/tilejson.json',
      }),
      sourceId: 'base',
    });

    await sourceCache.requestTile({
      level: 3,
      x: 2,
      y: 1,
    });

    expect(loadTile).toHaveBeenCalledTimes(1);
    expect(loadTile.mock.calls[0]![0]!.url).toBe(
      'https://tiles.example.com/catalog/3/2/6.pbf',
    );
  });

  it('会把在途 tile 请求的 priority 作为静态值传给调度器', async () => {
    let resolveTileRequest: (value: ArrayBuffer) => void = () => {};
    const tilePromise = new Promise<ArrayBuffer>((resolve) => {
      resolveTileRequest = resolve;
    });
    let capturedArgs: unknown[] = [];
    const loadTile = vi.fn((...args: unknown[]) => {
      capturedArgs = args;
      return tilePromise;
    });
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }, 8);

    await Promise.resolve();
    await Promise.resolve();

    expect(loadTile).toHaveBeenCalledTimes(1);
    expect(capturedArgs.length).toBe(3);
    expect(capturedArgs[2]).toBe(8);

    const secondPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }, 2);

    expect(loadTile).toHaveBeenCalledTimes(1);
    expect(capturedArgs.length).toBe(3);
    expect(capturedArgs[2]).toBe(8);

    resolveTileRequest(new Uint8Array([1, 2, 3]).buffer);

    await expect(firstPromise).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(secondPromise).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('returns a copy of cached ArrayBuffer to prevent detached buffer issues', async () => {
    const originalValue = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const loadTile = vi.fn(async () => originalValue);
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;

    expect(firstResult.byteLength).toBe(5);

    const secondResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;

    expect(secondResult.byteLength).toBe(5);
    expect(secondResult).not.toBe(firstResult);

    expect(loadTile).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached ArrayBuffer intact after the returned copy is transferred', async () => {
    const originalValue = new Uint8Array([9, 8, 7, 6]).buffer;
    const loadTile = vi.fn(async () => originalValue);
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;
    structuredClone(firstResult, { transfer: [firstResult] });

    const secondResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;

    expect(secondResult.byteLength).toBe(4);
    expect(loadTile).toHaveBeenCalledTimes(1);
  });

  it('caches an empty ArrayBuffer instead of reloading it', async () => {
    const loadTile = vi.fn(async () => new ArrayBuffer(0));
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    const firstResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;
    const secondResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;

    expect(firstResult.byteLength).toBe(0);
    expect(secondResult.byteLength).toBe(0);
    expect(loadTile).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used ready tile when the cache budget is exceeded', async () => {
    const value = new Uint8Array([1, 2, 3]).buffer;
    const loadTile = vi.fn(async () => value);
    const sourceCache = new SourceCache({
      loadTile,
      maxBytes: 6,
      source: createVectorSource(),
      sourceId: 'base',
    } as any);

    await expect(sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    })).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 1,
    })).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    })).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 2,
    })).resolves.toBeInstanceOf(ArrayBuffer);

    expect(sourceCache.getEntry('base/1/0/1')).toBeUndefined();
    expect(sourceCache.getEntry('base/1/0/0')).toMatchObject({
      state: 'ready',
    });
    expect(sourceCache.getEntry('base/1/0/2')).toMatchObject({
      state: 'ready',
    });

    await expect(sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 1,
    })).resolves.toBeInstanceOf(ArrayBuffer);

    expect(loadTile).toHaveBeenCalledTimes(4);
  });

  it('shares the ready budget with compiled tiles when a shared budget is provided', async () => {
    const sharedBudget = new TileBudget({
      maxBytes: 6,
    });
    const loadTile = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const sourceCache = new SourceCache({
      loadTile,
      readyTileBudget: sharedBudget,
      source: createVectorSource(),
      sourceId: 'base',
    });
    const cacheManager = new TileCacheManager({
      readyTileBudget: sharedBudget,
    });

    await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    });
    cacheManager.set('render/1', {
      byteLength: 3,
    } as any);

    await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    });
    cacheManager.set('render/2', {
      byteLength: 3,
    } as any);

    expect(sourceCache.getEntry('base/1/0/0')).toMatchObject({
      state: 'ready',
    });
    expect(cacheManager.has('render/1')).toBe(false);
    expect(cacheManager.has('render/2')).toBe(true);
    expect(loadTile).toHaveBeenCalledTimes(1);
  });

  it('returns an isolated copy from getEntry', async () => {
    const value = new Uint8Array([1, 2, 3]).buffer;
    const loadTile = vi.fn(async () => value);
    const sourceCache = new SourceCache({
      loadTile,
      source: createVectorSource(),
      sourceId: 'base',
    });

    await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    });
    const entry = sourceCache.getEntry('base/1/0/0');
    if (entry?.value instanceof ArrayBuffer) {
      structuredClone(entry.value, { transfer: [entry.value] });
    }

    const secondResult = (await sourceCache.requestTile({
      level: 1,
      x: 0,
      y: 0,
    }))!;

    expect(secondResult.byteLength).toBe(3);
    expect(loadTile).toHaveBeenCalledTimes(1);
  });
});
