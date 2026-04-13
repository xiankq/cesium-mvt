import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from 'geojson';
import type { FeatureTile } from '@/mvt/render/feature-tile';
import type {
  FeatureTileWorkerMessage,
  FeatureTileWorkerResponse,
} from '@/mvt/render/feature-tile-dispatcher';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeatureTileDispatcher } from '@/mvt/render/feature-tile-dispatcher';
import { createRenderOrder } from '@/mvt/render/render-order';
import { compileRenderTile, createRenderTileKey } from '@/mvt/render/render-tile';
import { createLayerFamilies } from '@/mvt/style/layer-family';

function createComplexTileBuffer() {
  const land: FeatureCollection<Polygon, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        },
        properties: {
          kind: 'park',
        },
      },
    ],
  };
  const road: FeatureCollection<LineString | Point, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[0, 0], [1, 1]],
        },
        properties: {
          kind: 'main',
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0.5, 0.5],
        },
        properties: {
          kind: 'ignore-me',
        },
      },
    ],
  };
  const poi: FeatureCollection<Point, { name: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0.25, 0.25],
        },
        properties: {
          name: 'cafe',
        },
      },
    ],
  };
  const encoded = fromGeojsonVt({
    land: getTileForFixture(land),
    poi: getTileForFixture(poi),
    road: getTileForFixture(road),
  } as Parameters<typeof fromGeojsonVt>[0]);

  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

function createRenderTileFixture() {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      base: {
        type: 'vector',
        tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#102030',
        },
      },
      {
        'id': 'land',
        'type': 'fill',
        'source': 'base',
        'source-layer': 'land',
      },
      {
        'id': 'road',
        'type': 'line',
        'source': 'base',
        'source-layer': 'road',
      },
      {
        'id': 'poi',
        'type': 'circle',
        'source': 'base',
        'source-layer': 'poi',
      },
    ],
  };
  const layerFamilies = createLayerFamilies(style);
  const renderOrder = createRenderOrder(style, layerFamilies);

  return compileRenderTile({
    key: createRenderTileKey('base', 0, 0, 0),
    layerFamilies,
    renderOrder,
    style,
    styleEpoch: 1,
  });
}

function getTileForFixture(data: FeatureCollection) {
  const tile = new GeoJSONVT(data).getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  return tile;
}

class FakeWorker {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  readonly postMessage = vi.fn((message: FeatureTileWorkerMessage) => {
    this.lastMessage = message;
  });

  readonly terminate = vi.fn();

  lastMessage?: FeatureTileWorkerMessage;

  addEventListener(type: string, listener: (event: unknown) => void) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }

    listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emitMessage(data: FeatureTileWorkerResponse) {
    const listeners = [...(this.listeners.get('message') ?? [])];
    for (const listener of listeners) {
      listener({ data });
    }
  }
}

describe('feature-tile-dispatcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('当 Worker 支持不可用时回退到内联编译', async () => {
    vi.stubGlobal('Worker', undefined);
    const dispatcher = createFeatureTileDispatcher();

    const featureTile = await dispatcher.compile({
      renderTile: createRenderTileFixture(),
      tileData: createComplexTileBuffer(),
    });

    expect(featureTile).toMatchObject({
      epoch: 1,
      geometryBatches: [
        {
          featureCount: 1,
          type: 'fill',
        },
        {
          featureCount: 1,
          type: 'line',
        },
        {
          featureCount: 1,
          type: 'circle',
        },
      ],
      key: 'base/0/0/0@1',
    });

    dispatcher.destroy();
  });

  it('当提供 worker factory 时通过 worker 分发 feature tile 编译任务', async () => {
    const fakeWorker = new FakeWorker();
    const dispatcher = createFeatureTileDispatcher({
      workerFactory: () => fakeWorker as never,
    });
    const renderTile = createRenderTileFixture();
    const pendingFeatureTile = dispatcher.compile({
      renderTile,
      tileData: createComplexTileBuffer(),
    });
    const message = fakeWorker.lastMessage;
    if (!message || message.type !== 'compile-feature-tile') {
      throw new Error('Expected compile request to be posted to worker.');
    }

    fakeWorker.emitMessage({
      featureTile: {
        background: renderTile.background,
        epoch: renderTile.epoch,
        geometryBatches: [],
        key: renderTile.key,
      } satisfies FeatureTile,
      id: message.id,
      type: 'feature-tile-result',
    });

    await expect(pendingFeatureTile).resolves.toMatchObject({
      epoch: 1,
      geometryBatches: [],
      key: 'base/0/0/0@1',
    });
    expect(fakeWorker.postMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('当 worker 报告编译失败时使用 worker 错误消息拒绝', async () => {
    const fakeWorker = new FakeWorker();
    const dispatcher = createFeatureTileDispatcher({
      workerFactory: () => fakeWorker as never,
    });
    const pendingFeatureTile = dispatcher.compile({
      renderTile: createRenderTileFixture(),
      tileData: createComplexTileBuffer(),
    });
    const compileMessage = fakeWorker.lastMessage;
    if (!compileMessage || compileMessage.type !== 'compile-feature-tile') {
      throw new Error('Expected compile request to be posted to worker.');
    }

    fakeWorker.emitMessage({
      error: 'worker failed to parse tile',
      id: compileMessage.id,
      type: 'feature-tile-error',
    });

    await expect(pendingFeatureTile).rejects.toThrow('worker failed to parse tile');

    dispatcher.destroy();
  });

  it('当 worker 报告空错误值时回退到通用错误消息', async () => {
    const fakeWorker = new FakeWorker();
    const dispatcher = createFeatureTileDispatcher({
      workerFactory: () => fakeWorker as never,
    });
    const pendingFeatureTile = dispatcher.compile({
      renderTile: createRenderTileFixture(),
      tileData: createComplexTileBuffer(),
    });
    const compileMessage = fakeWorker.lastMessage;
    if (!compileMessage || compileMessage.type !== 'compile-feature-tile') {
      throw new Error('Expected compile request to be posted to worker.');
    }

    fakeWorker.emitMessage({
      error: undefined as never,
      id: compileMessage.id,
      type: 'feature-tile-error',
    });

    await expect(pendingFeatureTile).rejects.toThrow('Feature tile worker failed.');

    dispatcher.destroy();
  });

  it('当 worker 任务被中止时以 AbortError 拒绝并终止 worker', async () => {
    const fakeWorker = new FakeWorker();
    const dispatcher = createFeatureTileDispatcher({
      workerFactory: () => fakeWorker as never,
    });
    const abortController = new AbortController();
    const pendingFeatureTile = dispatcher.compile({
      renderTile: createRenderTileFixture(),
      signal: abortController.signal,
      tileData: createComplexTileBuffer(),
    });
    const compileMessage = fakeWorker.postMessage.mock.calls[0]?.[0];
    if (!compileMessage || compileMessage.type !== 'compile-feature-tile') {
      throw new Error('Expected compile request to be posted to worker.');
    }

    abortController.abort();

    await expect(pendingFeatureTile).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fakeWorker.postMessage).toHaveBeenCalledTimes(1);
    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });
});
