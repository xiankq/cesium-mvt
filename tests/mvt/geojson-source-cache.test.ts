import type { GeoJSONSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point } from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeojsonSourceCache } from '@/mvt/source/geojson-source-cache';

function createGeojsonSource(
  overrides: Partial<GeoJSONSourceSpecification> = {},
): GeoJSONSourceSpecification {
  return {
    data: {
      features: [],
      type: 'FeatureCollection',
    },
    type: 'geojson',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geojson-source-cache', () => {
  it('keeps the cached tile buffer intact after the returned copy is transferred', async () => {
    const data: FeatureCollection = {
      features: [
        {
          geometry: {
            coordinates: [0, 0],
            type: 'Point',
          } as Point,
          properties: {
            name: 'poi',
          },
          type: 'Feature',
        },
      ],
      type: 'FeatureCollection',
    };
    const loadData = vi.fn(async () => data);
    const sourceCache = new GeojsonSourceCache({
      loadData,
      source: createGeojsonSource(),
      sourceId: 'places',
    });

    const firstResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;
    structuredClone(firstResult, { transfer: [firstResult] });

    const secondResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;

    expect(secondResult.byteLength).toBeGreaterThan(0);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('销毁后不应该再启动新的 GeoJSON 请求', async () => {
    const loadData = vi.fn(async () => ({
      features: [],
      type: 'FeatureCollection',
    } satisfies FeatureCollection));
    const sourceCache = new GeojsonSourceCache({
      loadData,
      source: createGeojsonSource({
        data: 'https://example.com/data.geojson',
      }),
      sourceId: 'places',
    });

    sourceCache.destroy();

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBeUndefined();

    expect(loadData).not.toHaveBeenCalled();
  });

  it('销毁期间完成的 GeoJSON 加载不应该写回缓存', async () => {
    let resolveData: (value: FeatureCollection) => void = () => {};
    const dataPromise = new Promise<FeatureCollection>((resolve) => {
      resolveData = resolve;
    });
    const loadData = vi.fn(() => dataPromise);
    const readyTileBudget = {
      add: vi.fn(),
      delete: vi.fn(),
      touch: vi.fn(),
    };
    const sourceCache = new GeojsonSourceCache({
      loadData,
      readyTileBudget: readyTileBudget as any,
      source: createGeojsonSource({
        data: 'https://example.com/data.geojson',
      }),
      sourceId: 'places',
    });

    const requestPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });

    sourceCache.destroy();
    resolveData({
      features: [],
      type: 'FeatureCollection',
    } satisfies FeatureCollection);

    await expect(requestPromise).resolves.toBeUndefined();
    expect(readyTileBudget.add).not.toHaveBeenCalled();
  });

  it('caches an empty GeoJSON tile instead of reloading it', async () => {
    const loadData = vi.fn(async () => ({
      features: [],
      type: 'FeatureCollection',
    } satisfies FeatureCollection));
    const getTileSpy = vi.spyOn(GeoJSONVT.prototype as any, 'getTile');
    const sourceCache = new GeojsonSourceCache({
      loadData,
      source: createGeojsonSource(),
      sourceId: 'places',
    });

    const firstResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;
    const secondResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;

    expect(firstResult.byteLength).toBe(0);
    expect(secondResult.byteLength).toBe(0);
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(getTileSpy).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used ready tile when the cache budget is exceeded', async () => {
    const data: FeatureCollection = {
      features: [
        {
          geometry: {
            coordinates: [0, 0],
            type: 'Point',
          } as Point,
          properties: {
            name: 'poi',
          },
          type: 'Feature',
        },
      ],
      type: 'FeatureCollection',
    };
    const loadData = vi.fn(async () => data);
    const sourceCache = new GeojsonSourceCache({
      loadData,
      maxBytes: 1,
      source: createGeojsonSource(),
      sourceId: 'places',
    } as any);

    const firstResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;
    expect(firstResult.byteLength).toBeGreaterThan(0);

    const secondResult = (await sourceCache.requestTile({
      level: 2,
      x: 2,
      y: 3,
    }))!;
    expect(secondResult.byteLength).toBeGreaterThan(0);

    expect(sourceCache.getEntry('places/2/1/3')).toBeUndefined();
    expect(sourceCache.getEntry('places/2/2/3')).toMatchObject({
      state: 'ready',
    });

    const thirdResult = (await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }))!;
    expect(thirdResult.byteLength).toBeGreaterThan(0);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight tile request and allows the tile to be requested again', async () => {
    const abortedError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const data: FeatureCollection = {
      features: [],
      type: 'FeatureCollection',
    };
    const loadData = vi.fn((_, signal: AbortSignal) => new Promise<FeatureCollection>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortedError);
        return;
      }

      signal.addEventListener('abort', () => reject(abortedError), {
        once: true,
      });

      if (loadData.mock.calls.length === 2) {
        resolve(data);
      }
    }));
    const sourceCache = new GeojsonSourceCache({
      loadData,
      source: createGeojsonSource(),
      sourceId: 'places',
    });
    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    });
    sourceCache.abortTile('places/2/1/3');

    await expect(firstPromise).resolves.toBeUndefined();

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBeInstanceOf(ArrayBuffer);
    expect(loadData).toHaveBeenCalledTimes(2);
  });

  it('会把在途 geojson 请求的 priority state 作为共享状态传给调度器', async () => {
    let resolveGeojson: (value: FeatureCollection) => void = () => {};
    const dataPromise = new Promise<FeatureCollection>((resolve) => {
      resolveGeojson = resolve;
    });
    let capturedArgs: unknown[] = [];
    const loadData = vi.fn((...args: unknown[]) => {
      capturedArgs = args;
      return dataPromise;
    });
    const priorityState = { value: 8 };
    const sourceCache = new GeojsonSourceCache({
      loadData,
      source: createGeojsonSource(),
      sourceId: 'places',
    });

    const firstPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }, priorityState);

    await Promise.resolve();

    expect(loadData).toHaveBeenCalledTimes(1);
    expect(capturedArgs.length).toBe(3);
    expect(capturedArgs[2]).toBe(priorityState);

    const secondPromise = sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }, { value: 2 });

    expect(loadData).toHaveBeenCalledTimes(1);
    expect(capturedArgs.length).toBe(3);
    expect(capturedArgs[2]).toBe(priorityState);
    expect(priorityState.value).toBe(2);

    resolveGeojson({
      features: [],
      type: 'FeatureCollection',
    });

    await expect(firstPromise).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(secondPromise).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('backs off failed tile requests before retrying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T00:00:00Z'));

    const networkError = new Error('network failed');
    const loadData = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        features: [],
        type: 'FeatureCollection',
      } satisfies FeatureCollection);
    const sourceCache = new GeojsonSourceCache({
      loadData,
      source: createGeojsonSource(),
      sourceId: 'places',
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

    expect(loadData).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBeInstanceOf(ArrayBuffer);

    expect(loadData).toHaveBeenCalledTimes(2);
    expect(sourceCache.getNextRetryAt()).toBeUndefined();

    vi.useRealTimers();
  });
});
