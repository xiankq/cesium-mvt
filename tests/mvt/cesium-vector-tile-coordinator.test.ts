import type {
  SourceSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point } from 'geojson';
import type { ParsedTileResult } from '@/mvt/bucket';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function createCoordinator(options: Record<string, unknown> = {}) {
  const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
  const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

  return new CesiumVectorTileCoordinator({
    minimumLevel: 0,
    rectangle: Rectangle.MAX_VALUE,
    root: new PrimitiveCollection(),
    tileWidth: 256,
    tilingScheme: new WebMercatorTilingScheme(),
    ...options,
  });
}

function createStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: 'vector',
        tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        'id': 'land',
        'source': 'base',
        'source-layer': 'land',
        'type': 'fill',
      },
    ],
  };
}

function createRenderedTileBuffer() {
  const data: FeatureCollection<Point, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          kind: 'cafe',
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

function createParsedTileResult(key: string) {
  return {
    buckets: [],
    byteLength: 0,
    epoch: 1,
    key,
  };
}

function createFeatureStateCircleTile(
  key: string,
  layerId = 'poi',
  sourceLayer = 'poi',
): ParsedTileResult {
  return {
    buckets: [
      {
        data: {
          featureIds: new Float32Array([0]),
          positions: new Float64Array([0, 0, 0]),
        },
        familyId: `base/${sourceLayer}/circle/0` as never,
        featureIndex: {
          byteLength: 200,
          entries: [
            {
              id: 1,
              properties: {},
              type: 'point',
            },
          ],
        },
        layerIds: [layerId],
        sourceLayer,
        stats: {
          byteLength: 24,
          featureCount: 1,
          pointCount: 1,
          type: 'circle',
        },
        type: 'circle',
      } as never,
    ],
    byteLength: 24,
    epoch: 1,
    key,
  };
}

function createAbortError() {
  return Object.assign(new Error('aborted'), {
    name: 'AbortError',
  });
}

function createAbortableSourceManager() {
  const sourceIds = new Set<string>();
  const pendingRequests = new Map<string, (error: unknown) => void>();

  const requestTile = vi.fn((
    sourceId: string,
    level: number,
    x: number,
    y: number,
    renderTileKey: string,
    _tilingScheme?: unknown,
    _renderTile?: unknown,
    _style?: unknown,
    _priority?: number,
  ) => {
    if (!sourceIds.has(sourceId)) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    if (requestTile.mock.calls.length === 1) {
      return new Promise((_, reject) => {
        pendingRequests.set(renderTileKey, reject);
      });
    }

    return Promise.resolve(createParsedTileResult(`${sourceId}/${level}/${x}/${y}@1`));
  });

  return {
    abort: vi.fn((key: string) => {
      const reject = pendingRequests.get(key);
      if (!reject) {
        return;
      }

      pendingRequests.delete(key);
      reject(createAbortError());
    }),
    abortAll: vi.fn(() => {
      for (const [key, reject] of pendingRequests) {
        pendingRequests.delete(key);
        reject(createAbortError());
      }
    }),
    destroy: vi.fn(),
    getNextRetryAt: vi.fn(() => undefined),
    getSourceConstraints: vi.fn(() => ({})),
    getSourceIds: vi.fn(() => Array.from(sourceIds)),
    isDestroyed: vi.fn(() => false),
    reconcileSources: vi.fn((sources: Record<string, SourceSpecification>) => {
      sourceIds.clear();
      for (const sourceId of Object.keys(sources)) {
        sourceIds.add(sourceId);
      }
    }),
    requestTile,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cesiumVectorTileCoordinator', () => {
  it('每帧都会驱动 RequestScheduler 更新', async () => {
    const { RequestScheduler } = await import('cesium');
    const updateSpy = vi.spyOn(RequestScheduler as any, 'update');
    const coordinator = await createCoordinator();

    coordinator.update({
      camera: {},
      viewportWidth: 100,
    });

    expect(updateSpy).toHaveBeenCalled();
  });

  it('每帧开始时应该标记共享缓存的 frame 边界', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const cacheManager = (coordinator as any).cacheManager;
    const beginFrameSpy = vi.spyOn(cacheManager, 'beginFrame');

    coordinator.update({
      camera: {},
      viewportWidth: 100,
    });

    expect(beginFrameSpy).toHaveBeenCalledTimes(1);
  });

  it('更新样式后应该在新帧中排队请求重新渲染', async () => {
    const coordinator = await createCoordinator();

    coordinator.updateStyle(createStyle());

    const frameState = {
      afterRender: [] as Array<() => boolean | void>,
      newFrame: true,
    };

    (coordinator as any).prePassesUpdate(frameState);

    expect(frameState.afterRender).toHaveLength(1);
    expect(frameState.afterRender[0]?.()).toBe(true);

    coordinator.destroy();
  });

  it('应该暴露请求 编译 缓存和渲染观测快照', async () => {
    const coordinator = await createCoordinator();

    coordinator.updateStyle(createStyle());

    expect(coordinator.getMetrics()).toMatchObject({
      cache: {
        currentBytes: 0,
        entryCount: 0,
        evictCount: 0,
        hitCount: 0,
        missCount: 0,
        maxBytes: expect.any(Number),
      },
      render: {
        hideCount: 0,
        mountCount: 0,
        removeCount: 0,
      },
      source: {
        compileCount: 0,
        pendingRequestCount: 0,
        requestCount: 0,
        workerQueueDepth: 0,
      },
    });

    coordinator.destroy();
  });

  it('更新样式时不应该重复驱逐同一批渲染句柄', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const renderManager = (coordinator as any).renderManager;
    const cacheManager = (coordinator as any).cacheManager;
    const renderKey = `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`;
    const bucketTile = createParsedTileResult(renderKey);

    renderManager.mount(renderKey, bucketTile, createStyle());
    cacheManager.set(renderKey, bucketTile);

    const removeSpy = vi.spyOn(renderManager, 'remove');
    const clearSpy = vi.spyOn(renderManager, 'clear');

    coordinator.updateStyle({
      ...createStyle(),
      layers: [
        {
          'id': 'water',
          'source': 'base',
          'source-layer': 'water',
          'type': 'fill',
        },
      ],
    });

    expect(removeSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(renderManager.getHandle(renderKey)).toBeUndefined();
  });

  it('hideInvisibleTiles 不应该因为遍历快照被修改而漏掉瓦片', async () => {
    const coordinator = await createCoordinator();
    const renderKeys = ['base/0/0/0', 'base/0/1/0'];
    const renderManager = {
      getAllKeys: vi.fn(() => renderKeys),
      getVisibleKeys: vi.fn(() => renderKeys),
      hide: vi.fn((key: string) => {
        const index = renderKeys.indexOf(key);
        if (index >= 0) {
          renderKeys.splice(index, 1);
        }
        return true;
      }),
      remove: vi.fn(() => true),
    };
    const cacheManager = {
      has: vi.fn(() => false),
      setVisibility: vi.fn(),
    };

    (coordinator as any).renderManager = renderManager;
    (coordinator as any).cacheManager = cacheManager;

    (coordinator as any).hideInvisibleTiles(new Set<string>());

    expect(cacheManager.setVisibility).toHaveBeenCalledTimes(2);
    expect(renderManager.hide).toHaveBeenCalledTimes(2);
    expect(renderManager.remove).toHaveBeenCalledTimes(2);
  });

  it('queryRenderedFeatures 会读取可见渲染瓦片', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle({
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'source': 'base',
          'source-layer': 'poi',
          'type': 'circle',
        },
      ],
    });

    const renderKey = `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`;
    const tileBuffer = createRenderedTileBuffer();
    const sourceManager = (coordinator as any).sourceManager;
    const renderManager = (coordinator as any).renderManager;

    sourceManager.getSourceCache = vi.fn(() => ({
      getEntry: vi.fn(() => ({
        state: 'ready',
        value: tileBuffer,
      })),
    }));
    renderManager.getAllKeys = vi.fn(() => [renderKey]);
    renderManager.getHandle = vi.fn(() => ({
      visible: true,
    }));

    const renderedFeatures = coordinator.queryRenderedFeatures({
      filter: ['==', ['get', 'kind'], 'cafe'],
    });

    expect(renderedFeatures).toHaveLength(1);
    expect(renderedFeatures[0]).toMatchObject({
      id: 1,
      layerId: 'poi',
      properties: {
        kind: 'cafe',
      },
      sourceId: 'base',
      sourceLayer: 'poi',
      type: 'Feature',
    });
  });

  it('会按请求顺序传递优先级', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());
    const sourceManager = createAbortableSourceManager();
    (coordinator as any).sourceManager = sourceManager;
    sourceManager.reconcileSources(createStyle().sources as Record<string, SourceSpecification>);

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 1, y: 0 },
    ]);

    const priorities = sourceManager.requestTile.mock.calls.map(call => call[8]);
    expect(priorities).toEqual([0, 1]);
  });

  it('会优先请求视图中心附近的瓦片', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());
    const sourceManager = createAbortableSourceManager();
    (coordinator as any).sourceManager = sourceManager;
    sourceManager.reconcileSources(createStyle().sources as Record<string, SourceSpecification>);

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 1, y: 0 },
      { level: 0, x: 2, y: 0 },
      { level: 0, x: 0, y: 1 },
      { level: 0, x: 1, y: 1 },
      { level: 0, x: 2, y: 1 },
      { level: 0, x: 0, y: 2 },
      { level: 0, x: 1, y: 2 },
      { level: 0, x: 2, y: 2 },
    ]);

    expect(sourceManager.requestTile.mock.calls[0]?.slice(0, 4)).toEqual([
      'base',
      0,
      1,
      1,
    ]);
  });

  it('会把处于重试冷却的 source 排到后面', async () => {
    const coordinator = await createCoordinator();
    const retryAt = Date.now() + 5000;
    coordinator.updateStyle({
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
        labels: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'land',
          'source': 'base',
          'source-layer': 'land',
          'type': 'fill',
        },
      ],
    });

    const sourceManager = {
      abort: vi.fn(),
      abortAll: vi.fn(),
      destroy: vi.fn(),
      getNextRetryAt: vi.fn((sourceId?: string) => {
        if (sourceId === 'base') {
          return retryAt;
        }

        return undefined;
      }),
      getSourceConstraints: vi.fn(() => ({})),
      getSourceIds: vi.fn(() => ['base', 'labels']),
      isDestroyed: vi.fn(() => false),
      reconcileSources: vi.fn(),
      requestTile: vi.fn(() => new Promise<void>(() => {})),
    };
    (coordinator as any).sourceManager = sourceManager;
    sourceManager.reconcileSources({
      base: {
        type: 'vector',
        tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
      },
      labels: {
        type: 'vector',
        tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
      },
    });

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([
      { level: 0, x: 0, y: 0 },
    ]);

    const requestTileMock = sourceManager.requestTile as unknown as {
      mock: {
        calls: unknown[][];
      };
    };
    expect(requestTileMock.mock.calls[0]?.[0]).toBe('labels');
    expect(requestTileMock.mock.calls[1]?.[0]).toBe('base');
  });

  it('待处理瓦片再次进入时会重新进入请求链路而不是被 pending 早退', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const sourceManager = {
      abort: vi.fn(),
      abortAll: vi.fn(),
      destroy: vi.fn(),
      getNextRetryAt: vi.fn(() => undefined),
      getSourceConstraints: vi.fn(() => ({})),
      getSourceIds: vi.fn(() => ['base']),
      isDestroyed: vi.fn(() => false),
      reconcileSources: vi.fn(),
      requestTile: vi.fn(() => new Promise<void>(() => {})),
    };
    (coordinator as any).sourceManager = sourceManager;

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 1, y: 0 },
    ]);
    processTileSelection([
      { level: 0, x: 1, y: 0 },
      { level: 0, x: 0, y: 0 },
    ]);

    const requestTileMock = sourceManager.requestTile as any;
    expect(requestTileMock).toHaveBeenCalledTimes(4);
    expect(requestTileMock.mock.calls.slice(0, 2).map((call: any[]) => call[8])).toEqual([0, 1]);
    expect(requestTileMock.mock.calls.slice(2, 4).map((call: any[]) => call[8])).toEqual([0, 1]);
  });

  it('请求失败后不应该写入空瓦片并阻断后续重试', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const sourceManager = (coordinator as any).sourceManager;
    const renderManager = (coordinator as any).renderManager;
    const requestSpy = vi.spyOn(sourceManager, 'requestTile')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(createParsedTileResult('base/0/0/0@1'));

    const requestTile = (coordinator as any).requestTile.bind(coordinator);
    await requestTile('base', 0, 0, 0);

    const renderKey = `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`;
    expect(renderManager.getHandle(renderKey)).toBeUndefined();

    await requestTile('base', 0, 0, 0);

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(renderManager.getHandle(renderKey)).toBeDefined();
  });

  it('异步瓦片完成挂载后应该在新帧中排队请求重新渲染', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    let resolveRequest: (value: ParsedTileResult | undefined) => void = () => {};
    const requestPromise = new Promise<ParsedTileResult | undefined>((resolve) => {
      resolveRequest = resolve;
    });

    const sourceManager = {
      abort: vi.fn(),
      abortAll: vi.fn(),
      destroy: vi.fn(),
      getNextRetryAt: vi.fn(() => undefined),
      getSourceConstraints: vi.fn(() => ({})),
      getSourceIds: vi.fn(() => ['base']),
      isDestroyed: vi.fn(() => false),
      reconcileSources: vi.fn(),
      requestTile: vi.fn(() => requestPromise),
    };
    (coordinator as any).sourceManager = sourceManager;

    const requestTile = (coordinator as any).requestTile.bind(coordinator);
    const pending = requestTile('base', 0, 0, 0);

    // 先把样式更新触发的补帧消费掉，避免把前一帧的状态算进来。
    const styleFrameState = {
      afterRender: [] as Array<() => boolean | void>,
      newFrame: true,
    };
    (coordinator as any).prePassesUpdate(styleFrameState);

    expect(styleFrameState.afterRender).toHaveLength(1);
    expect(styleFrameState.afterRender[0]?.()).toBe(true);

    resolveRequest(createParsedTileResult('base/0/0/0@1'));
    await pending;

    const frameState = {
      afterRender: [] as Array<() => boolean | void>,
      newFrame: true,
    };
    (coordinator as any).prePassesUpdate(frameState);

    expect(frameState.afterRender).toHaveLength(1);
    expect(frameState.afterRender[0]?.()).toBe(true);
    expect((coordinator as any).renderManager.getHandle(
      `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`,
    )).toBeDefined();
  });

  it('失败请求到达重试时间后会重新触发一次选择更新', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T00:00:00Z'));

    try {
      const coordinator = await createCoordinator();
      coordinator.updateStyle(createStyle());

      const processTileSelection = vi.fn();
      (coordinator as any).processTileSelection = processTileSelection;
      const renderKey = `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`;
      (coordinator as any).requestedTileKeys = new Set([renderKey]);

      let invalidated = false;
      const retryAt = Date.now() + 1000;
      const scheduler = {
        commit: vi.fn(() => {
          invalidated = false;
        }),
        invalidate: vi.fn(() => {
          invalidated = true;
        }),
        schedule: vi.fn(() => ({
          coordinates: [
            { level: 0, x: 0, y: 0 },
          ],
          key: 'base/0/0/0',
        })),
        shouldUpdate: vi.fn(() => {
          return processTileSelection.mock.calls.length === 0 || invalidated;
        }),
        resolveSourceTiles: vi.fn(),
      };
      (coordinator as any).scheduler = scheduler;

      const sourceManager = {
        abort: vi.fn(),
        abortAll: vi.fn(),
        destroy: vi.fn(),
        getNextRetryAt: vi.fn(() => retryAt),
        getSourceConstraints: vi.fn(() => ({})),
        getSourceIds: vi.fn(() => ['base']),
        reconcileSources: vi.fn(),
        requestTile: vi.fn(),
      };
      (coordinator as any).sourceManager = sourceManager;

      coordinator.update({
        camera: {},
        viewportWidth: 100,
      });

      expect(processTileSelection).toHaveBeenCalledTimes(1);
      expect(scheduler.invalidate).not.toHaveBeenCalled();

      coordinator.update({
        camera: {},
        viewportWidth: 100,
      });

      expect(processTileSelection).toHaveBeenCalledTimes(1);
      expect(scheduler.invalidate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      coordinator.update({
        camera: {},
        viewportWidth: 100,
      });

      expect(scheduler.invalidate).toHaveBeenCalledTimes(1);
      expect(processTileSelection).toHaveBeenCalledTimes(2);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('feature-state 写入后会刷新已挂载瓦片并排队请求重新渲染', async () => {
    const { BufferPoint, BufferPointMaterial } = await import('cesium');
    const coordinator = await createCoordinator();
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'paint': {
            'circle-color': ['case', ['==', ['feature-state', 'selected'], true], '#ff0000', '#0000ff'],
            'circle-radius': 5,
          },
          'source': 'base',
          'source-layer': 'poi',
          'type': 'circle',
        },
      ],
    };

    coordinator.updateStyle(style);

    const renderKey = `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`;
    const bucketTile = createFeatureStateCircleTile(renderKey);
    (bucketTile.buckets[0] as any).familyId = 'base/poi/circle/0';
    const renderManager = (coordinator as any).renderManager;
    const cacheManager = (coordinator as any).cacheManager;

    renderManager.mount(renderKey, bucketTile, style);
    cacheManager.set(renderKey, bucketTile);

    const point = new BufferPoint();
    const material = new BufferPointMaterial();
    const initialHandle = renderManager.getHandle(renderKey);
    if (!initialHandle) {
      throw new Error('Expected render handle to exist before feature-state update.');
    }

    initialHandle.collections[0]?.collection.get(0, point);
    const initialMaterial = point.getMaterial(material) as unknown as {
      color: {
        alpha: number;
        blue: number;
        green: number;
        red: number;
      };
    };
    expect(initialMaterial.color.red).toBeCloseTo(0, 4);
    expect(initialMaterial.color.blue).toBeCloseTo(1, 4);

    coordinator.setFeatureState({
      id: 1,
      sourceId: 'base',
    }, {
      selected: true,
    });

    const frameState = {
      afterRender: [] as Array<() => boolean | void>,
    };
    (coordinator as any).prePassesUpdate(frameState);

    expect(frameState.afterRender).toHaveLength(1);
    expect(frameState.afterRender[0]?.()).toBe(true);

    const refreshedHandle = renderManager.getHandle(renderKey);
    if (!refreshedHandle) {
      throw new Error('Expected render handle to exist after feature-state update.');
    }

    refreshedHandle.collections[0]?.collection.get(0, point);
    const refreshedMaterial = point.getMaterial(material) as unknown as {
      color: {
        alpha: number;
        blue: number;
        green: number;
        red: number;
      };
    };
    expect(refreshedMaterial.color.red).toBeCloseTo(1, 4);
    expect(refreshedMaterial.color.blue).toBeCloseTo(0, 4);
  });

  it('feature-state 指定 sourceLayer 时只会刷新对应 sourceLayer 的渲染瓦片', async () => {
    const coordinator = await createCoordinator();
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'paint': {
            'circle-color': ['case', ['==', ['feature-state', 'selected'], true], '#ff0000', '#0000ff'],
            'circle-radius': 5,
          },
          'source': 'base',
          'source-layer': 'poi',
          'type': 'circle',
        },
        {
          'id': 'roads',
          'paint': {
            'circle-color': ['case', ['==', ['feature-state', 'selected'], true], '#ff0000', '#0000ff'],
            'circle-radius': 5,
          },
          'source': 'base',
          'source-layer': 'roads',
          'type': 'circle',
        },
      ],
    };

    coordinator.updateStyle(style);

    const renderManager = (coordinator as any).renderManager;
    const cacheManager = (coordinator as any).cacheManager;
    const styleEpoch = (coordinator as any).styleManager.getStyleEpoch();
    const poiKey = `${styleEpoch}:base/0/0/0`;
    const roadsKey = `${styleEpoch}:base/0/0/1`;
    const poiTile = createFeatureStateCircleTile(poiKey, 'poi', 'poi');
    const roadsTile = createFeatureStateCircleTile(roadsKey, 'roads', 'roads');
    const refreshSourceSpy = vi.spyOn(renderManager, 'refreshSource');
    const refreshSourceLayerSpy = vi.spyOn(renderManager, 'refreshSourceLayer');

    renderManager.mount(poiKey, poiTile, style);
    renderManager.mount(roadsKey, roadsTile, style);
    cacheManager.set(poiKey, poiTile);
    cacheManager.set(roadsKey, roadsTile);

    coordinator.setFeatureState({
      id: 1,
      sourceId: 'base',
      sourceLayer: 'poi',
    }, {
      selected: true,
    });

    expect(refreshSourceLayerSpy).toHaveBeenCalledTimes(1);
    expect(refreshSourceLayerSpy).toHaveBeenCalledWith(
      'base',
      'poi',
      expect.any(Function),
      style,
      expect.anything(),
      1,
    );
    expect(refreshSourceSpy).not.toHaveBeenCalled();
    expect(renderManager.getHandle(poiKey)).toBeDefined();
    expect(renderManager.getHandle(roadsKey)).toBeDefined();
  });

  it('feature-state 刷新多个同 sourceLayer 瓦片时应该只重排一次符号', async () => {
    const coordinator = await createCoordinator();
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'paint': {
            'circle-color': ['case', ['==', ['feature-state', 'selected'], true], '#ff0000', '#0000ff'],
            'circle-radius': 5,
          },
          'source': 'base',
          'source-layer': 'poi',
          'type': 'circle',
        },
      ],
    };

    coordinator.updateStyle(style);

    const renderManager = (coordinator as any).renderManager;
    const cacheManager = (coordinator as any).cacheManager;
    const styleEpoch = (coordinator as any).styleManager.getStyleEpoch();
    const firstKey = `${styleEpoch}:base/0/0/0`;
    const secondKey = `${styleEpoch}:base/0/0/1`;
    const firstTile = createFeatureStateCircleTile(firstKey, 'poi', 'poi');
    const secondTile = createFeatureStateCircleTile(secondKey, 'poi', 'poi');

    renderManager.mount(firstKey, firstTile, style);
    renderManager.mount(secondKey, secondTile, style);
    cacheManager.set(firstKey, firstTile);
    cacheManager.set(secondKey, secondTile);

    const beforeMetrics = renderManager.getProfilingMetrics();

    coordinator.setFeatureState({
      id: 1,
      sourceId: 'base',
      sourceLayer: 'poi',
    }, {
      selected: true,
    });

    const afterMetrics = renderManager.getProfilingMetrics();
    expect(afterMetrics.symbolReconcileCount - beforeMetrics.symbolReconcileCount).toBe(1);
  });

  it('processTileSelection 同时展示和隐藏瓦片时应该只重排一次符号', async () => {
    const coordinator = await createCoordinator();
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'paint': {
            'circle-color': '#0000ff',
            'circle-radius': 5,
          },
          'source': 'base',
          'source-layer': 'poi',
          'type': 'circle',
        },
      ],
    };

    coordinator.updateStyle(style);

    const renderManager = (coordinator as any).renderManager;
    const cacheManager = (coordinator as any).cacheManager;
    const scheduler = (coordinator as any).scheduler;
    const sourceManager = (coordinator as any).sourceManager;
    const styleEpoch = (coordinator as any).styleManager.getStyleEpoch();
    const visibleKey = `${styleEpoch}:base/0/0/1`;
    const hiddenKey = `${styleEpoch}:base/0/0/0`;
    const visibleTile = createFeatureStateCircleTile(visibleKey, 'poi', 'poi');
    const hiddenTile = createFeatureStateCircleTile(hiddenKey, 'poi', 'poi');

    renderManager.mount(visibleKey, visibleTile, style);
    renderManager.mount(hiddenKey, hiddenTile, style);
    cacheManager.set(visibleKey, visibleTile);
    cacheManager.set(hiddenKey, hiddenTile);
    renderManager.hide(hiddenKey);

    const showSpy = vi.spyOn(renderManager, 'show');
    const hideSpy = vi.spyOn(renderManager, 'hide');
    const beforeMetrics = renderManager.getProfilingMetrics();

    vi.spyOn(scheduler, 'resolveSourceTiles').mockReturnValue({
      fallbackCoordinates: [],
      readyCoordinates: [{ level: 0, x: 0, y: 0 }],
      requestCoordinates: [],
    } as any);
    vi.spyOn(sourceManager, 'getSourceIds').mockReturnValue(['base']);
    vi.spyOn(sourceManager, 'getSourceConstraints').mockReturnValue({});
    vi.spyOn(sourceManager, 'getNextRetryAt').mockReturnValue(undefined);

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([{ level: 0, x: 0, y: 0 }]);

    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(renderManager.getProfilingMetrics().symbolReconcileCount - beforeMetrics.symbolReconcileCount).toBe(1);
  });

  it('视图变化时应该取消过期的待处理请求', async () => {
    const coordinator = await createCoordinator();
    (coordinator as any).sourceManager = createAbortableSourceManager();
    coordinator.updateStyle(createStyle());

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([{ level: 0, x: 0, y: 0 }]);

    const sourceManager = (coordinator as any).sourceManager;
    const firstRequestPromise = sourceManager.requestTile.mock.results[0]?.value as Promise<unknown>;

    processTileSelection([{ level: 0, x: 1, y: 0 }]);

    await expect(firstRequestPromise).rejects.toMatchObject({
      name: 'AbortError',
    });

    const renderKey = `${(coordinator as any).styleManager.getStyleEpoch()}:base/0/0/0`;
    expect(sourceManager.abort).toHaveBeenCalledWith(renderKey);
    expect((coordinator as any).renderManager.getHandle(renderKey)).toBeUndefined();
  });

  it('同一帧内重复选中的瓦片只会发起一次请求', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const sourceManager = {
      abort: vi.fn(),
      abortAll: vi.fn(),
      destroy: vi.fn(),
      getNextRetryAt: vi.fn(() => undefined),
      getSourceConstraints: vi.fn(() => ({})),
      getSourceIds: vi.fn(() => ['base']),
      isDestroyed: vi.fn(() => false),
      reconcileSources: vi.fn(),
      requestTile: vi.fn(() => new Promise<void>(() => {})),
    };
    (coordinator as any).sourceManager = sourceManager;
    sourceManager.reconcileSources(createStyle().sources as Record<string, SourceSpecification>);

    const processTileSelection = (coordinator as any).processTileSelection.bind(coordinator);
    processTileSelection([
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 1, y: 0 },
    ]);

    expect(sourceManager.requestTile).toHaveBeenCalledTimes(2);
    expect(sourceManager.requestTile.mock.calls.map((call: any[]) => call.slice(1, 4))).toEqual([
      [0, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('取消请求不应该打印错误日志', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sourceManager = {
      abort: vi.fn(),
      abortAll: vi.fn(),
      destroy: vi.fn(),
      getNextRetryAt: vi.fn(() => undefined),
      getSourceConstraints: vi.fn(() => ({})),
      getSourceIds: vi.fn(() => ['base']),
      isDestroyed: vi.fn(() => false),
      reconcileSources: vi.fn(),
      requestTile: vi.fn(() => Promise.reject(Object.assign(new Error('aborted'), {
        name: 'AbortError',
      }))),
    };
    (coordinator as any).sourceManager = sourceManager;

    const requestTile = (coordinator as any).requestTile.bind(coordinator);
    await requestTile('base', 0, 0, 0);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('销毁期间完成的请求不应该在销毁后继续挂载', async () => {
    const coordinator = await createCoordinator();
    coordinator.updateStyle(createStyle());

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let resolveRequest: (value: ParsedTileResult | undefined) => void = () => {};
    const requestPromise = new Promise<ParsedTileResult | undefined>((resolve) => {
      resolveRequest = resolve;
    });

    const sourceManager = {
      abort: vi.fn(),
      abortAll: vi.fn(),
      destroy: vi.fn(),
      getNextRetryAt: vi.fn(() => undefined),
      getSourceConstraints: vi.fn(() => ({})),
      getSourceIds: vi.fn(() => ['base']),
      isDestroyed: vi.fn(() => false),
      reconcileSources: vi.fn(),
      requestTile: vi.fn(() => requestPromise),
    };
    (coordinator as any).sourceManager = sourceManager;

    const renderManager = (coordinator as any).renderManager;
    const mountSpy = vi.spyOn(renderManager, 'mount');
    const requestTile = (coordinator as any).requestTile.bind(coordinator);
    const pending = requestTile('base', 0, 0, 0);

    resolveRequest(createParsedTileResult('base/0/0/0@1'));
    coordinator.destroy();

    await pending;

    expect(mountSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  describe('destroy', () => {
    it('应该能够安全地多次调用 destroy', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      coordinator.destroy();
      coordinator.destroy();

      expect(true).toBe(true);
    });

    it('销毁后应该标记为已销毁', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      expect(coordinator.isDestroyed()).toBe(false);

      coordinator.destroy();

      expect(coordinator.isDestroyed()).toBe(true);
    });

    it('销毁后 update 不应该执行任何操作', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      coordinator.destroy();

      coordinator.update({
        camera: {},
        viewportWidth: 100,
      });

      expect(true).toBe(true);
    });

    it('销毁后 updateStyle 不应该执行任何操作', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      coordinator.destroy();

      coordinator.updateStyle({
        version: 8,
        sources: {},
        layers: [],
      });

      expect(true).toBe(true);
    });
  });
});
