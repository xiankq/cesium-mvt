import { describe, expect, it, vi } from 'vitest';
import { createMockStyle } from '../../helpers/style-helpers';

describe('sourceManager', () => {
  describe('destroy', () => {
    it('应该能够安全地多次调用 destroy', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();

      sourceManager.reconcileSources({
        test: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      });

      sourceManager.destroy();
      sourceManager.destroy();

      expect(true).toBe(true);
    });

    it('销毁后应该标记为已销毁', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();

      expect(sourceManager.isDestroyed()).toBe(false);

      sourceManager.destroy();

      expect(sourceManager.isDestroyed()).toBe(true);
    });

    it('销毁后 reconcileSources 不应该执行任何操作', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();

      sourceManager.destroy();

      sourceManager.reconcileSources({
        test: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      });

      expect(sourceManager.getSourceIds()).toHaveLength(0);
    });

    it('销毁时应该中止所有待处理的请求', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();

      sourceManager.reconcileSources({
        test: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      });

      const tilingScheme = {
        tileXYToNativeRectangle: () => ({
          west: 0,
          south: 0,
          east: 1,
          north: 1,
        }),
      } as any;

      const renderTile = {
        key: 'test/0/0/0',
        epoch: 1,
        sourceId: 'test',
        batches: [],
        geometryBatches: [],
      } as any;
      const style = createMockStyle('fill');

      const requestPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'test/0/0/0',
        tilingScheme,
        renderTile,
        style,
        () => {},
      );

      sourceManager.destroy();

      await expect(requestPromise).rejects.toThrow();

      // 验证多次调用 destroy 的安全性
      sourceManager.destroy();
    });

    it('销毁后不应该抛出未捕获的 Promise 拒绝', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockDispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      const sourceManager = new SourceManager();
      (sourceManager as any).bucketTileDispatcher = mockDispatcher;

      sourceManager.reconcileSources({
        test: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      });

      const compileSpy = vi.spyOn(mockDispatcher, 'compile');
      compileSpy.mockImplementation(() => new Promise(() => {}));

      const tilingScheme = {
        tileXYToNativeRectangle: () => ({
          west: 0,
          south: 0,
          east: 1,
          north: 1,
        }),
      } as any;

      const renderTile = {
        key: 'test/0/0/0',
        epoch: 1,
        sourceId: 'test',
        batches: [],
        geometryBatches: [],
      } as any;
      const style = createMockStyle('fill');

      const requestPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'test/0/0/0',
        tilingScheme,
        renderTile,
        style,
        () => {},
      );

      sourceManager.destroy();

      await expect(requestPromise).rejects.toThrow();

      // 验证多次调用 destroy 的安全性
      sourceManager.destroy();
    });

    it('同一个待处理请求再次进入时会复用同一个请求且不引入额外优先级状态', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();
      let capturedArgs: unknown[] = [];
      let resolveTileData: (value: ArrayBuffer) => void = () => {};
      const tileDataPromise = new Promise<ArrayBuffer>((resolve) => {
        resolveTileData = resolve;
      });
      const sourceCache = {
        abortTile: vi.fn(),
        destroy: vi.fn(),
        getMaxZoom: vi.fn(() => undefined),
        getMinZoom: vi.fn(() => undefined),
        isDestroyed: vi.fn(() => false),
        requestTile: vi.fn((...args: unknown[]) => {
          capturedArgs = args;
          return tileDataPromise;
        }),
        sourceType: 'vector' as const,
        updateSource: vi.fn(),
      };
      const bucketTileDispatcher = {
        compile: vi.fn(async () => ({
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: 'test/0/0/0@1',
        })),
        destroy: vi.fn(),
      };

      (sourceManager as any).sourceCaches.set('test', sourceCache);
      (sourceManager as any).bucketTileDispatcher = bucketTileDispatcher;

      const renderTile = {
        epoch: 1,
        geometryBatches: [],
        key: 'render/0',
      } as any;
      const style = createMockStyle('fill');
      const tilingScheme = {
        tileXYToNativeRectangle: () => ({
          east: 1,
          north: 1,
          south: 0,
          west: 0,
        }),
      } as any;

      const firstPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'render/0',
        tilingScheme,
        renderTile,
        style,
        () => {},
        8,
      );

      expect(sourceCache.requestTile).toHaveBeenCalledTimes(1);
      expect(capturedArgs.length).toBe(2);
      expect(capturedArgs[1]).toBe(8);

      const secondPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'render/0',
        tilingScheme,
        renderTile,
        style,
        () => {},
        2,
      );

      expect(sourceCache.requestTile).toHaveBeenCalledTimes(1);
      expect(capturedArgs.length).toBe(2);
      expect(capturedArgs[1]).toBe(8);

      resolveTileData(new Uint8Array([1, 2, 3]).buffer);

      await expect(firstPromise).resolves.toMatchObject({
        key: 'test/0/0/0@1',
      });
      await expect(secondPromise).resolves.toMatchObject({
        key: 'test/0/0/0@1',
      });
      expect(bucketTileDispatcher.compile).toHaveBeenCalledTimes(1);
    });

    it('会返回最早到期的失败重试时间', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();
      const baseRetryAt = Date.parse('2026-04-13T00:00:05Z');
      const labelsRetryAt = Date.parse('2026-04-13T00:00:03Z');
      (sourceManager as any).sourceCaches.set('base', {
        destroy: vi.fn(),
        getEntry: vi.fn((key: string) => {
          if (key === 'base/0/0/0') {
            return {
              nextRetryAt: baseRetryAt,
              state: 'failed',
            };
          }

          return undefined;
        }),
        getMaxZoom: vi.fn(() => undefined),
        getMinZoom: vi.fn(() => undefined),
        getNextRetryAt: vi.fn(() => baseRetryAt),
        isDestroyed: vi.fn(() => false),
        requestTile: vi.fn(),
        sourceType: 'vector' as const,
        updateSource: vi.fn(),
      });
      (sourceManager as any).sourceCaches.set('labels', {
        destroy: vi.fn(),
        getEntry: vi.fn((key: string) => {
          if (key === 'labels/0/0/0') {
            return {
              nextRetryAt: labelsRetryAt,
              state: 'failed',
            };
          }

          return undefined;
        }),
        getMaxZoom: vi.fn(() => undefined),
        getMinZoom: vi.fn(() => undefined),
        getNextRetryAt: vi.fn(() => labelsRetryAt),
        isDestroyed: vi.fn(() => false),
        requestTile: vi.fn(),
        sourceType: 'vector' as const,
        updateSource: vi.fn(),
      });

      expect(sourceManager.getNextRetryAt()).toBe(labelsRetryAt);
      expect(sourceManager.getNextRetryAt('base')).toBe(baseRetryAt);
      expect(sourceManager.getNextRetryAt(new Set([
        '12:base/0/0/0',
        '12:labels/0/0/0',
      ]))).toBe(labelsRetryAt);
    });

    it('应该优先使用 source 上直接声明的 minzoom/maxzoom', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');

      const sourceManager = new SourceManager();
      sourceManager.reconcileSources({
        base: {
          maxzoom: 11,
          minzoom: 4,
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
          type: 'vector',
        } as any,
        geojson: {
          data: {
            features: [],
            type: 'FeatureCollection',
          },
          maxzoom: 9,
          minzoom: 2,
          type: 'geojson',
        } as any,
      });

      expect(sourceManager.getSourceConstraints('base')).toEqual({
        maxZoom: 11,
        minZoom: 4,
      });
      expect(sourceManager.getSourceConstraints('geojson')).toEqual({
        maxZoom: 9,
        minZoom: 2,
      });
    });

    it('当编译在取消后才完成时，不应继续提交瓦片', async () => {
      const { SourceManager } = await import('@/mvt/source/source-manager');
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const sourceManager = new SourceManager();

      sourceManager.reconcileSources({
        test: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      });

      let resolveTileData: (value: ArrayBuffer) => void = () => {};
      const tileDataPromise = new Promise<ArrayBuffer>((resolve) => {
        resolveTileData = resolve;
      });
      let resolveCompile: (value: { buckets: never[]; byteLength: number; epoch: number; key: string }) => void = () => {};
      const compilePromise = new Promise<{ buckets: never[]; byteLength: number; epoch: number; key: string }>((resolve) => {
        resolveCompile = resolve;
      });
      const bucketTileDispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });
      (bucketTileDispatcher as any).compile = vi.fn(() => compilePromise);
      (sourceManager as any).bucketTileDispatcher = bucketTileDispatcher;

      const sourceCache = {
        abortTile: vi.fn(),
        destroy: vi.fn(),
        getMaxZoom: vi.fn(() => undefined),
        getMinZoom: vi.fn(() => undefined),
        isDestroyed: vi.fn(() => false),
        requestTile: vi.fn(() => tileDataPromise),
        sourceType: 'vector' as const,
        updateSource: vi.fn(),
      };
      (sourceManager as any).sourceCaches.set('test', sourceCache);

      const renderTile = {
        epoch: 1,
        geometryBatches: [],
        key: 'render/0',
      } as any;
      const style = createMockStyle('fill');
      const tilingScheme = {
        tileXYToNativeRectangle: () => ({
          east: 1,
          north: 1,
          south: 0,
          west: 0,
        }),
      } as any;
      const onCompile = vi.fn();

      const requestPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'render/0',
        tilingScheme,
        renderTile,
        style,
        onCompile,
      );

      resolveTileData(new Uint8Array([1, 2, 3]).buffer);
      await Promise.resolve();
      await Promise.resolve();

      expect(bucketTileDispatcher.compile).toHaveBeenCalledTimes(1);

      sourceManager.abort('render/0');
      resolveCompile({
        buckets: [],
        byteLength: 0,
        epoch: 1,
        key: 'test/0/0/0@1',
      });

      await expect(requestPromise).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(onCompile).not.toHaveBeenCalled();
    });
  });
});
