import type { FeatureCollection } from 'geojson';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createGeojsonSource() {
  return {
    data: 'https://example.com/data.geojson',
    type: 'geojson',
  } as const;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geojson-source-cache request scheduler integration', () => {
  it('通过 request-scheduler 调度 GeoJSON 请求', async () => {
    vi.resetModules();

    const requestScheduler = await import('@/mvt/source/request-scheduler');
    const scheduleJsonSpy = vi.spyOn(requestScheduler, 'scheduleJsonRequest')
      .mockResolvedValue({
        features: [
          {
            geometry: {
              coordinates: [0, 0],
              type: 'Point',
            },
            properties: {
              name: 'poi',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      } satisfies FeatureCollection);
    const { GeojsonSourceCache } = await import('@/mvt/source/geojson-source-cache');
    const priorityState = { value: 4 };

    const sourceCache = new GeojsonSourceCache({
      source: createGeojsonSource(),
      sourceId: 'places',
    });

    const result = await sourceCache.requestTile({
      level: 2,
      x: 1,
      y: 3,
    }, priorityState);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(scheduleJsonSpy).toHaveBeenCalledTimes(1);
    expect(scheduleJsonSpy).toHaveBeenCalledWith(expect.objectContaining({
      priority: priorityState,
      url: 'https://example.com/data.geojson',
    }));
  });
});
