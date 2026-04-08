import type { MvtTileLoader } from '../src/mvt/tile/mvt-tile-loader';
import { describe, expect, it, vi } from 'vitest';
import { MvtTilesetPrimitive } from '../src/mvt/render/mvt-tileset-primitive';
import { createMvtTileKey } from '../src/mvt/tile/mvt-tile-key';
import { MvtTileStore } from '../src/mvt/tile/mvt-tile-store';
import { createTestLocalMvtArrayBuffer, createTestMvtArrayBuffer } from './mvt-test-tile';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

async function flushPrimitiveAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('mvt-tileset-primitive', () => {
  it('loads raw tile data and advances to ready through upload budget', async () => {
    const requestRender = vi.fn();
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 1024,
      maxGpuCacheBytes: 1024,
      protectedFrames: 0,
    });
    const tileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]],
              type: 'Polygon',
            },
            properties: {
              name: 'Primitive Test Building',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });
    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockResolvedValue({
      arrayBuffer: tileBuffer,
      byteLength: tileBuffer.byteLength,
      url: 'https://example.com/4/5/6.pbf',
    });
    const primitive = new MvtTilesetPrimitive({
      maxConcurrentLoads: 1,
      maxUploadBytesPerFrame: 16,
      maxUploadTilesPerFrame: 1,
      requestRender,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(await loadOpenFreeMapBrightStyleSet());

    tileStore.beginFrame(0);
    const tile = tileStore.touchTile({ x: 5, y: 6, z: 4 }, 4);
    tile.setState('loading');
    tileStore.queueLoad(tile, 4);

    primitive.update({ frameNumber: 1 });
    expect(loadTile).toHaveBeenCalledTimes(1);

    await flushPrimitiveAsyncWork();

    expect(tile.state).toBe('parse-queued');
    expect(primitive.getStats().parseQueueSize).toBe(1);
    expect(primitive.getStats().sourceCacheBytes).toBeGreaterThan(0);
    expect(requestRender).toHaveBeenCalledTimes(1);

    primitive.update({ frameNumber: 2 });

    expect(tile.state).toBe('ready');
    expect(tile.parsedByteLength).toBe(0);
    expect(tile.parsedTileData).toBeUndefined();
    expect(tile.meshData).toBeUndefined();
    expect(tileStore.cpuCacheBytes).toBe(0);
    expect(tile.gpuByteLength).toBeGreaterThan(0);
    expect(tileStore.gpuCacheBytes).toBe(tile.gpuByteLength);
    expect(requestRender).toHaveBeenCalledTimes(3);
  }, 15000);

  it('uses the current visible tile set to keep rendering in-sync with Cesium globe imagery', async () => {
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 1024 * 1024,
      maxGpuCacheBytes: 1024 * 1024,
      protectedFrames: 0,
    });
    const tileBuffer = createTestLocalMvtArrayBuffer({
      place: {
        features: [{
          geometry: {
            coordinates: [[[256, 256], [256, 1024], [1024, 1024], [1024, 256], [256, 256]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Visible Set Building',
          },
        }],
      },
    });
    let visibleCoordinates = [{ x: 5, y: 6, z: 4 }];
    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockImplementation(async (coordinate) => {
      return {
        arrayBuffer: tileBuffer,
        byteLength: tileBuffer.byteLength,
        url: `https://example.com/${coordinate.z}/${coordinate.x}/${coordinate.y}.pbf`,
      };
    });
    const primitive = new MvtTilesetPrimitive({
      fallbackFrameWindow: 1,
      getVisibleTileCoordinates: () => visibleCoordinates,
      maxConcurrentLoads: 1,
      maxUploadBytesPerFrame: 1024 * 1024,
      maxUploadTilesPerFrame: 2,
      staleFrameWindow: 1,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(await loadOpenFreeMapBrightStyleSet());

    primitive.update({ frameNumber: 1 });
    expect(loadTile).toHaveBeenCalledWith({ x: 5, y: 6, z: 4 }, expect.any(AbortSignal));

    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 2 });

    const firstTile = tileStore.getTile(createMvtTileKey({ x: 5, y: 6, z: 4 }));
    expect(firstTile?.state).toBe('ready');
    expect(firstTile?.lastRenderedFrame).toBe(2);

    visibleCoordinates = [{ x: 7, y: 8, z: 4 }];
    primitive.update({ frameNumber: 3 });
    expect(loadTile).toHaveBeenCalledWith({ x: 7, y: 8, z: 4 }, expect.any(AbortSignal));
    expect(firstTile?.lastRenderedFrame).toBe(3);

    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 4 });
    primitive.update({ frameNumber: 5 });

    const secondTile = tileStore.getTile(createMvtTileKey({ x: 7, y: 8, z: 4 }));
    expect(secondTile?.state).toBe('ready');
    expect(secondTile?.lastRenderedFrame).toBe(5);
    expect(firstTile?.lastRenderedFrame).toBe(3);
  });

  it('renders a ready parent tile as fallback for a recently requested child tile', async () => {
    const requestRender = vi.fn();
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 2048,
      maxGpuCacheBytes: 4096,
      protectedFrames: 0,
    });
    const parentTileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]],
              type: 'Polygon',
            },
            properties: {
              name: 'Fallback Parent Building',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });
    const unrelatedTileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[4, 4], [4, 8], [8, 8], [8, 4], [4, 4]]],
              type: 'Polygon',
            },
            properties: {
              name: 'Unrelated Building',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    let resolveChildLoad!: (value: Awaited<ReturnType<MvtTileLoader['loadTile']>>) => void;
    const childLoadPromise = new Promise<Awaited<ReturnType<MvtTileLoader['loadTile']>>>((resolve) => {
      resolveChildLoad = resolve;
    });

    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockImplementation(async (coordinate) => {
      if (coordinate.x === 2 && coordinate.y === 3 && coordinate.z === 3) {
        return {
          arrayBuffer: parentTileBuffer,
          byteLength: parentTileBuffer.byteLength,
          url: 'https://example.com/3/2/3.pbf',
        };
      }

      if (coordinate.x === 7 && coordinate.y === 1 && coordinate.z === 3) {
        return {
          arrayBuffer: unrelatedTileBuffer,
          byteLength: unrelatedTileBuffer.byteLength,
          url: 'https://example.com/3/7/1.pbf',
        };
      }

      return await childLoadPromise;
    });
    const primitive = new MvtTilesetPrimitive({
      fallbackFrameWindow: 2,
      maxConcurrentLoads: 2,
      maxUploadBytesPerFrame: 1024 * 1024,
      maxUploadTilesPerFrame: 4,
      requestRender,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(await loadOpenFreeMapBrightStyleSet());

    tileStore.beginFrame(0);
    const parentTile = tileStore.touchTile({ x: 2, y: 3, z: 3 }, 3);
    parentTile.setState('loading');
    tileStore.queueLoad(parentTile, 3);

    const unrelatedTile = tileStore.touchTile({ x: 7, y: 1, z: 3 }, 3);
    unrelatedTile.setState('loading');
    tileStore.queueLoad(unrelatedTile, 3);

    primitive.update({ frameNumber: 1 });
    await flushPrimitiveAsyncWork();

    primitive.update({ frameNumber: 2 });

    expect(parentTile.state).toBe('ready');
    expect(unrelatedTile.state).toBe('ready');
    expect(parentTile.lastRenderedFrame).toBe(2);
    expect(unrelatedTile.lastRenderedFrame).toBe(2);

    const childTile = tileStore.touchTile({ x: 4, y: 6, z: 4 }, 4);
    childTile.setState('loading');
    tileStore.queueLoad(childTile, 4);

    primitive.update({ frameNumber: 3 });

    expect(loadTile).toHaveBeenCalledWith({ x: 4, y: 6, z: 4 }, expect.any(AbortSignal));
    expect(parentTile.lastRenderedFrame).toBe(3);
    expect(unrelatedTile.lastRenderedFrame).toBe(2);
    expect(childTile.lastRenderedFrame).toBe(-1);

    resolveChildLoad({
      arrayBuffer: parentTileBuffer,
      byteLength: parentTileBuffer.byteLength,
      url: 'https://example.com/4/4/6.pbf',
    });
  });

  it('loads overscaled display tiles from clamped source coordinates', async () => {
    const requestRender = vi.fn();
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 1024 * 1024,
      maxGpuCacheBytes: 1024 * 1024,
      protectedFrames: 0,
    });
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    expect(styleSet.source?.maxzoom).toBeGreaterThan(0);

    const tileBuffer = createTestLocalMvtArrayBuffer({
      building: {
        features: [{
          geometry: {
            coordinates: [[[1200, 3200], [1200, 3800], [1800, 3800], [1800, 3200], [1200, 3200]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Overscaled Building',
          },
        }],
      },
    });
    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockResolvedValue({
      arrayBuffer: tileBuffer,
      byteLength: tileBuffer.byteLength,
      url: 'https://example.com/14/2000/3000.pbf',
    });
    const primitive = new MvtTilesetPrimitive({
      maxConcurrentLoads: 1,
      maxUploadBytesPerFrame: 1024 * 1024,
      maxUploadTilesPerFrame: 4,
      requestRender,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(styleSet);

    tileStore.beginFrame(0);
    const overscaledTile = tileStore.touchTile({ x: 8001, y: 12003, z: 16 }, 16);
    overscaledTile.setState('loading');
    tileStore.queueLoad(overscaledTile, 16);

    primitive.update({ frameNumber: 1 });
    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 2 });

    const expectedSourceZoom = styleSet.source?.maxzoom;
    if (expectedSourceZoom === undefined) {
      throw new Error('Expected OpenFreeMap bright style source maxzoom to be defined.');
    }
    const zoomDelta = overscaledTile.coordinate.z - expectedSourceZoom;
    expect(loadTile).toHaveBeenCalledWith({
      x: Math.floor(overscaledTile.coordinate.x / 2 ** zoomDelta),
      y: Math.floor(overscaledTile.coordinate.y / 2 ** zoomDelta),
      z: expectedSourceZoom,
    }, expect.any(AbortSignal));
    expect(overscaledTile.sourceCoordinate).toEqual({
      x: Math.floor(overscaledTile.coordinate.x / 2 ** zoomDelta),
      y: Math.floor(overscaledTile.coordinate.y / 2 ** zoomDelta),
      z: expectedSourceZoom,
    });
    expect(overscaledTile.state).toBe('ready');
    expect(overscaledTile.gpuByteLength).toBeGreaterThan(0);
  });

  it('does not keep rendering a recently touched parent tile after a child tile becomes ready', async () => {
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 1024 * 1024,
      maxGpuCacheBytes: 1024 * 1024,
      protectedFrames: 0,
    });
    const tileBuffer = createTestLocalMvtArrayBuffer({
      building: {
        features: [{
          geometry: {
            coordinates: [[[1200, 1200], [1200, 1800], [1800, 1800], [1800, 1200], [1200, 1200]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Parent Child Duplicate Check',
          },
        }],
      },
    });
    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockResolvedValue({
      arrayBuffer: tileBuffer,
      byteLength: tileBuffer.byteLength,
      url: 'https://example.com/tile.pbf',
    });
    const primitive = new MvtTilesetPrimitive({
      fallbackFrameWindow: 4,
      maxConcurrentLoads: 1,
      maxUploadBytesPerFrame: 1024 * 1024,
      maxUploadTilesPerFrame: 4,
      staleFrameWindow: 4,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(await loadOpenFreeMapBrightStyleSet());

    tileStore.beginFrame(0);
    const parentTile = tileStore.touchTile({ x: 2, y: 3, z: 3 }, 3);
    parentTile.setState('loading');
    tileStore.queueLoad(parentTile, 3);

    primitive.update({ frameNumber: 1 });
    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 2 });
    expect(parentTile.state).toBe('ready');
    expect(parentTile.lastRenderedFrame).toBe(2);

    const childTile = tileStore.touchTile({ x: 4, y: 6, z: 4 }, 4);
    childTile.setState('loading');
    tileStore.queueLoad(childTile, 4);

    primitive.update({ frameNumber: 3 });
    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 4 });

    expect(childTile.state).toBe('ready');
    expect(childTile.lastRenderedFrame).toBe(4);
    expect(parentTile.lastRenderedFrame).toBe(3);
  });

  it('reuses cached source tiles for overscaled sibling display tiles', async () => {
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 1024 * 1024,
      maxGpuCacheBytes: 1024 * 1024,
      protectedFrames: 0,
    });
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestLocalMvtArrayBuffer({
      building: {
        features: [{
          geometry: {
            coordinates: [[[1200, 1200], [1200, 1800], [1800, 1800], [1800, 1200], [1200, 1200]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Shared Source Building',
          },
        }],
      },
    });
    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockResolvedValue({
      arrayBuffer: tileBuffer,
      byteLength: tileBuffer.byteLength,
      url: 'https://example.com/14/2000/3000.pbf',
    });
    const primitive = new MvtTilesetPrimitive({
      maxConcurrentLoads: 1,
      maxSourceCacheBytes: 1024 * 1024,
      maxUploadBytesPerFrame: 1024 * 1024,
      maxUploadTilesPerFrame: 4,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(styleSet);

    tileStore.beginFrame(0);
    const firstTile = tileStore.touchTile({ x: 8000, y: 12000, z: 16 }, 16);
    firstTile.setState('loading');
    tileStore.queueLoad(firstTile, 16);

    primitive.update({ frameNumber: 1 });
    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 2 });

    const secondTile = tileStore.touchTile({ x: 8001, y: 12000, z: 16 }, 16);
    secondTile.setState('loading');
    tileStore.queueLoad(secondTile, 16);

    primitive.update({ frameNumber: 3 });
    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 4 });

    expect(loadTile).toHaveBeenCalledTimes(1);
    expect(firstTile.sourceCoordinate).toEqual(secondTile.sourceCoordinate);
    expect(secondTile.state).toBe('ready');
    expect(primitive.getStats().sourceCacheBytes).toBeGreaterThan(0);
  });

  it('cancels stale inflight loads and starts newer requested tiles', async () => {
    const tileStore = new MvtTileStore({
      maxCpuCacheBytes: 1024 * 1024,
      maxGpuCacheBytes: 1024 * 1024,
      protectedFrames: 0,
    });
    const readyTileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]],
              type: 'Polygon',
            },
            properties: {
              name: 'Fresh Building',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    let staleAbortSignal: AbortSignal | undefined;
    const loadTile = vi.fn<MvtTileLoader['loadTile']>().mockImplementation(async (coordinate, signal) => {
      if (coordinate.x === 1 && coordinate.y === 1 && coordinate.z === 4) {
        staleAbortSignal = signal;
        return await new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }

      return {
        arrayBuffer: readyTileBuffer,
        byteLength: readyTileBuffer.byteLength,
        url: 'https://example.com/4/2/2.pbf',
      };
    });
    const primitive = new MvtTilesetPrimitive({
      maxConcurrentLoads: 1,
      maxUploadBytesPerFrame: 1024 * 1024,
      maxUploadTilesPerFrame: 4,
      staleFrameWindow: 1,
      tileLoaderFactory: () => ({
        loadTile,
      }),
      tileStore,
    });

    primitive.setStyleSet(await loadOpenFreeMapBrightStyleSet());

    tileStore.beginFrame(0);
    const staleTile = tileStore.touchTile({ x: 1, y: 1, z: 4 }, 4);
    staleTile.setState('loading');
    tileStore.queueLoad(staleTile, 4);

    primitive.update({ frameNumber: 1 });
    expect(loadTile).toHaveBeenCalledWith({ x: 1, y: 1, z: 4 }, expect.any(AbortSignal));

    const freshTile = tileStore.touchTile({ x: 2, y: 2, z: 4 }, 4);
    freshTile.setState('loading');
    tileStore.queueLoad(freshTile, 4);

    primitive.update({ frameNumber: 2 });
    expect(staleAbortSignal?.aborted).toBe(true);
    expect(loadTile).toHaveBeenCalledWith({ x: 2, y: 2, z: 4 }, expect.any(AbortSignal));

    await flushPrimitiveAsyncWork();
    primitive.update({ frameNumber: 3 });

    expect(staleTile.state).toBe('idle');
    expect(freshTile.state).toBe('ready');
  });
});
