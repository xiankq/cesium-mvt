import { describe, expect, it, vi } from 'vitest';

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

      const requestPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'test/0/0/0',
        tilingScheme,
        renderTile,
        () => {},
      );

      sourceManager.destroy();

      await expect(requestPromise).rejects.toThrow();

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

      const requestPromise = sourceManager.requestTile(
        'test',
        0,
        0,
        0,
        'test/0/0/0',
        tilingScheme,
        renderTile,
        () => {},
      );

      sourceManager.destroy();

      await expect(requestPromise).rejects.toThrow();

      sourceManager.destroy();
    });
  });
});
