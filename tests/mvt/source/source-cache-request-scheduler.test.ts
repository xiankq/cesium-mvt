import type {
  SourceSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createVectorSource(
  overrides: Partial<VectorSourceSpecification> = {},
): SourceSpecification {
  return {
    type: 'vector',
    url: 'https://tiles.example.com/catalog/tilejson.json',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('source-cache request scheduler integration', () => {
  it('通过 request-scheduler 调度 TileJSON 和瓦片请求', async () => {
    vi.resetModules();

    const requestScheduler = await import('@/mvt/source/request-scheduler');
    const tileJson = {
      tiles: ['./{z}/{x}/{y}.pbf'],
    };
    const tileBuffer = new Uint8Array([1, 2, 3]).buffer;
    const scheduleJsonSpy = vi.spyOn(requestScheduler, 'scheduleJsonRequest')
      .mockResolvedValue(tileJson);
    const scheduleTileSpy = vi.spyOn(requestScheduler, 'scheduleTileRequest')
      .mockResolvedValue(tileBuffer);
    const { SourceCache } = await import('@/mvt/source/source-cache');
    const priorityState = { value: 4 };

    const sourceCache = new SourceCache({
      source: createVectorSource(),
      sourceId: 'base',
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
      url: 'https://tiles.example.com/catalog/tilejson.json',
    }));
    expect(scheduleTileSpy).toHaveBeenCalledTimes(1);
    expect(scheduleTileSpy).toHaveBeenCalledWith(expect.objectContaining({
      priority: priorityState,
      url: 'https://tiles.example.com/catalog/2/1/3.pbf',
    }));
  });
});
