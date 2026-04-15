import type { FeatureCollection, Point } from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { describe, expect, it, vi } from 'vitest';
import { SourceManager } from '@/mvt/source/source-manager';

function createTileBuffer(name = 'poi-a') {
  const data: FeatureCollection<Point, { name: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          name,
        },
      },
    ],
  };

  const tileIndex = new GeoJSONVT(data);
  const tile = tileIndex.getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  const encoded = fromGeojsonVt({ poi: tile } as Parameters<typeof fromGeojsonVt>[0]);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

describe('source-manager querySourceFeatures', () => {
  it('应该返回已加载向量瓦片里的指定 source-layer 要素', () => {
    const sourceManager = new SourceManager();
    const tileBuffer = createTileBuffer();
    const sourceCache = {
      destroy: vi.fn(),
      getEntry: vi.fn(() => ({
        state: 'ready',
        value: tileBuffer,
      })),
      getLoadedTileKeys: vi.fn(() => ['base/0/0/0']),
      isDestroyed: vi.fn(() => false),
      sourceType: 'vector' as const,
      updateSource: vi.fn(),
    };

    (sourceManager as any).sourceCaches.set('base', sourceCache);

    const features = sourceManager.querySourceFeatures('base', {
      sourceLayer: 'poi',
    });

    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      type: 'Feature',
      properties: {
        name: 'poi-a',
      },
    });
    expect(features[0]?.geometry).toMatchObject({
      type: 'Point',
    });
  });

  it('应该按照 filter 过滤已加载的源要素', () => {
    const sourceManager = new SourceManager();
    const tileBuffer = createTileBuffer();
    const sourceCache = {
      destroy: vi.fn(),
      getEntry: vi.fn(() => ({
        state: 'ready',
        value: tileBuffer,
      })),
      getLoadedTileKeys: vi.fn(() => ['base/0/0/0']),
      isDestroyed: vi.fn(() => false),
      sourceType: 'vector' as const,
      updateSource: vi.fn(),
    };

    (sourceManager as any).sourceCaches.set('base', sourceCache);

    const features = sourceManager.querySourceFeatures('base', {
      filter: ['==', ['get', 'name'], 'poi-a'],
      sourceLayer: 'poi',
    });

    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toEqual({
      name: 'poi-a',
    });
  });

  it('应该优先读取 peekEntryValue 中的原始瓦片快照', () => {
    const sourceManager = new SourceManager();
    const entryBuffer = createTileBuffer('poi-a');
    const peekBuffer = createTileBuffer('poi-b');
    const sourceCache = {
      destroy: vi.fn(),
      getEntry: vi.fn(() => ({
        state: 'ready',
        value: entryBuffer,
      })),
      getLoadedTileKeys: vi.fn(() => ['base/0/0/0']),
      isDestroyed: vi.fn(() => false),
      peekEntryValue: vi.fn(() => peekBuffer),
      sourceType: 'vector' as const,
      updateSource: vi.fn(),
    };

    (sourceManager as any).sourceCaches.set('base', sourceCache);

    const features = sourceManager.querySourceFeatures('base', {
      sourceLayer: 'poi',
    });

    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toEqual({
      name: 'poi-b',
    });
  });

  it('应该跳过无法解析的 tile key', () => {
    const sourceManager = new SourceManager();
    const tileBuffer = createTileBuffer();
    const sourceCache = {
      destroy: vi.fn(),
      getEntry: vi.fn(() => ({
        state: 'ready',
        value: tileBuffer,
      })),
      getLoadedTileKeys: vi.fn(() => ['invalid-tile-key']),
      isDestroyed: vi.fn(() => false),
      sourceType: 'vector' as const,
      updateSource: vi.fn(),
    };

    (sourceManager as any).sourceCaches.set('base', sourceCache);

    const features = sourceManager.querySourceFeatures('base', {
      sourceLayer: 'poi',
    });

    expect(features).toHaveLength(0);
  });

  it('应该正确解析包含 / 的 sourceId 的重试时间', () => {
    const sourceManager = new SourceManager();
    const nextRetryAt = Date.now() + 1000;

    const sourceCache = {
      destroy: vi.fn(),
      getEntry: vi.fn(() => ({
        nextRetryAt,
        state: 'failed',
      })),
      getLoadedTileKeys: vi.fn(() => ['ns/base/0/0/0']),
      isDestroyed: vi.fn(() => false),
      sourceType: 'vector' as const,
      updateSource: vi.fn(),
    };

    (sourceManager as any).sourceCaches.set('ns/base', sourceCache);

    expect(sourceManager.getNextRetryAt(new Set(['0:ns/base/0/0/0']))).toBe(nextRetryAt);
  });
});
