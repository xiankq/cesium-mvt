import type { GeoJSONSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GeoJsonObject } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { GeojsonSourceCache } from '../../src/mvt/source/geojson-source-cache';

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

describe('geojson-source-cache', () => {
  it('aborts an in-flight tile request and allows the tile to be requested again', async () => {
    const abortedError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const data: GeoJsonObject = {
      features: [],
      type: 'FeatureCollection',
    };
    const loadData = vi.fn((_, signal: AbortSignal) => new Promise<GeoJsonObject>((resolve, reject) => {
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
    const abortTile = Reflect.get(sourceCache, 'abortTile');

    expect(abortTile).toBeTypeOf('function');
    (abortTile as (this: GeojsonSourceCache, key: string) => void).call(
      sourceCache,
      'places/2/1/3',
    );

    await expect(firstPromise).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    })).resolves.toBeInstanceOf(ArrayBuffer);
    expect(loadData).toHaveBeenCalledTimes(2);
  });
});
