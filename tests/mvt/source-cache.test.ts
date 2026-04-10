import type {
  SourceSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { TileRequest } from '@/mvt/source/tile-request';
import { describe, expect, it, vi } from 'vitest';
import { SourceCache } from '@/mvt/source/source-cache';

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
  it('deduplicates in-flight tile requests', async () => {
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

    await expect(firstPromise).resolves.toBe(value);
    await expect(secondPromise).resolves.toBe(value);
    expect(loadTile).toHaveBeenCalledTimes(1);
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

    await expect(firstPromise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(sourceCache.getEntry('base/2/1/3')).toMatchObject({
      key: 'base/2/1/3',
      state: 'idle',
    });

    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBe(value);
    expect(loadTile).toHaveBeenCalledTimes(2);
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

    await expect(sourceCache.requestTile({
      level: 3,
      x: 4,
      y: 5,
    })).resolves.toBe(tileValue);
    await expect(sourceCache.requestTile({
      level: 4,
      x: 5,
      y: 6,
    })).resolves.toBe(tileValue);

    expect(loadTileJson).toHaveBeenCalledTimes(1);
    expect(loadTile.mock.calls[0]![0]!.url).toBe(
      'https://tiles.example.com/catalog/3/4/5.pbf',
    );
    expect(loadTile.mock.calls[1]![0]!.url).toBe(
      'https://tiles.example.com/catalog/4/5/6.pbf',
    );
  });
});
