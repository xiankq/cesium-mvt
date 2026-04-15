import { describe, expect, it, vi } from 'vitest';
import { createMockStyle } from '../../helpers/style-helpers';

describe('bucket-tile-dispatcher', () => {
  describe('createBucketTileDispatcher', () => {
    it('当 worker factory 返回 undefined 时创建内联模式的 dispatcher', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      expect(dispatcher).toBeDefined();
      expect(dispatcher.compile).toBeInstanceOf(Function);
      expect(dispatcher.destroy).toBeInstanceOf(Function);
    });

    it('should create dispatcher with worker mode when worker factory returns worker', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockWorker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => mockWorker,
      });

      expect(dispatcher).toBeDefined();
      expect(dispatcher.compile).toBeInstanceOf(Function);
      expect(dispatcher.destroy).toBeInstanceOf(Function);
    });
  });

  describe('compile', () => {
    it('在内联模式下编译 bucket tile', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      const job = createMockJob();
      const result = await dispatcher.compile(job);

      expect(result).toBeDefined();
      expect(result.buckets).toBeInstanceOf(Array);
      expect(result.key).toBe(job.renderTile.key);
    });

    it('在 worker 模式下编译 bucket tile', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockWorker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => mockWorker,
      });

      const job = createMockJob();
      const compilePromise = dispatcher.compile(job);

      setTimeout(() => {
        const lastMessage = mockWorker.postMessage.mock.calls[mockWorker.postMessage.mock.calls.length - 1][0];
        mockWorker.simulateMessage({
          bucketTile: {
            buckets: [],
            byteLength: 0,
            epoch: 1,
            key: job.renderTile.key,
          },
          id: lastMessage.id,
          type: 'bucket-tile-result',
        });
      }, 10);

      const result = await compilePromise;
      expect(result).toBeDefined();
      expect(result.key).toBe(job.renderTile.key);
    });

    it('should fall back to a generic worker error message when the worker reports an empty error value', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockWorker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => mockWorker,
      });

      const job = createMockJob();
      const compilePromise = dispatcher.compile(job);
      const lastMessage = mockWorker.postMessage.mock.calls[mockWorker.postMessage.mock.calls.length - 1][0];

      mockWorker.simulateMessage({
        error: undefined,
        id: lastMessage.id,
        type: 'bucket-tile-error',
      });

      await expect(compilePromise).rejects.toThrow('Bucket tile worker failed.');

      dispatcher.destroy();
    });

    it('当 worker 池有空闲容量时使用多个 worker', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const worker1 = createMockWorker();
      const worker2 = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: createSequentialWorkerFactory([worker1, worker2]),
      });

      const firstJob = createMockJob({
        renderTile: {
          ...createMockJobBase().renderTile,
          key: 'source/0/0/0',
        },
      });
      const secondJob = createMockJob({
        renderTile: {
          ...createMockJobBase().renderTile,
          key: 'source/0/0/1',
        },
      });

      const firstPromise = dispatcher.compile(firstJob);
      const secondPromise = dispatcher.compile(secondJob);

      expect(worker1.postMessage).toHaveBeenCalledTimes(1);
      expect(worker2.postMessage).toHaveBeenCalledTimes(1);

      const firstMessage = worker1.postMessage.mock.calls[0][0];
      const secondMessage = worker2.postMessage.mock.calls[0][0];

      worker1.simulateMessage({
        bucketTile: {
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: firstJob.renderTile.key,
        },
        id: firstMessage.id,
        type: 'bucket-tile-result',
      });
      worker2.simulateMessage({
        bucketTile: {
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: secondJob.renderTile.key,
        },
        id: secondMessage.id,
        type: 'bucket-tile-result',
      });

      await expect(firstPromise).resolves.toMatchObject({
        key: firstJob.renderTile.key,
      });
      await expect(secondPromise).resolves.toMatchObject({
        key: secondJob.renderTile.key,
      });

      dispatcher.destroy();
    });

    it('将多余的任务排队直到 worker 变为可用', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const worker1 = createMockWorker();
      const worker2 = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: createSequentialWorkerFactory([worker1, worker2]),
      });

      const firstJob = createMockJob({
        renderTile: {
          ...createMockJobBase().renderTile,
          key: 'source/0/0/0',
        },
      });
      const secondJob = createMockJob({
        renderTile: {
          ...createMockJobBase().renderTile,
          key: 'source/0/0/1',
        },
      });
      const thirdJob = createMockJob({
        renderTile: {
          ...createMockJobBase().renderTile,
          key: 'source/0/0/2',
        },
      });

      const firstPromise = dispatcher.compile(firstJob);
      const secondPromise = dispatcher.compile(secondJob);
      const thirdPromise = dispatcher.compile(thirdJob);

      expect(worker1.postMessage).toHaveBeenCalledTimes(1);
      expect(worker2.postMessage).toHaveBeenCalledTimes(1);
      expect(dispatcher.getQueueDepth()).toBe(1);

      const firstMessage = worker1.postMessage.mock.calls[0][0];
      worker1.simulateMessage({
        bucketTile: {
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: firstJob.renderTile.key,
        },
        id: firstMessage.id,
        type: 'bucket-tile-result',
      });

      expect(worker1.postMessage).toHaveBeenCalledTimes(2);

      const secondMessage = worker2.postMessage.mock.calls[0][0];
      const thirdMessage = worker1.postMessage.mock.calls[1][0];
      worker2.simulateMessage({
        bucketTile: {
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: secondJob.renderTile.key,
        },
        id: secondMessage.id,
        type: 'bucket-tile-result',
      });
      worker1.simulateMessage({
        bucketTile: {
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: thirdJob.renderTile.key,
        },
        id: thirdMessage.id,
        type: 'bucket-tile-result',
      });

      await expect(firstPromise).resolves.toMatchObject({
        key: firstJob.renderTile.key,
      });
      await expect(secondPromise).resolves.toMatchObject({
        key: secondJob.renderTile.key,
      });
      await expect(thirdPromise).resolves.toMatchObject({
        key: thirdJob.renderTile.key,
      });

      dispatcher.destroy();
    });

    it('将原生墨卡托瓦片边界传递给 worker', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockWorker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => mockWorker,
      });

      const nativeRectangle = {
        west: -20037508.342789244,
        south: -20037508.342789244,
        east: 20037508.342789244,
        north: 20037508.342789244,
      };
      const geographicRectangle = {
        west: -Math.PI,
        south: -Math.PI / 2,
        east: Math.PI,
        north: Math.PI / 2,
      };
      const job = createMockJob({
        tilingScheme: {
          tileXYToNativeRectangle: vi.fn(() => nativeRectangle),
          tileXYToRectangle: vi.fn(() => geographicRectangle),
        } as any,
      });
      const compilePromise = dispatcher.compile(job);

      const lastMessage = mockWorker.postMessage.mock.calls[mockWorker.postMessage.mock.calls.length - 1][0];
      expect(lastMessage.tileProjection).toEqual(nativeRectangle);
      expect(job.tilingScheme.tileXYToNativeRectangle).toHaveBeenCalledWith(0, 0, 0);
      expect(job.tilingScheme.tileXYToRectangle).not.toHaveBeenCalled();

      mockWorker.simulateMessage({
        bucketTile: {
          buckets: [],
          byteLength: 0,
          epoch: 1,
          key: job.renderTile.key,
        },
        id: lastMessage.id,
        type: 'bucket-tile-result',
      });

      await expect(compilePromise).resolves.toBeDefined();
    });

    it('当 signal 已经中止时拒绝', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      const controller = new AbortController();
      controller.abort();

      const job = { ...createMockJob(), signal: controller.signal };

      await expect(dispatcher.compile(job)).rejects.toThrow();
    });

    it('当 dispatcher 被销毁时拒绝', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      dispatcher.destroy();

      const job = createMockJob();
      await expect(dispatcher.compile(job)).rejects.toThrow('destroyed');
    });

    it('should terminate the active worker when an in-flight compile is aborted', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const worker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: createSequentialWorkerFactory([worker]),
      });

      const controller = new AbortController();
      const job = { ...createMockJob(), signal: controller.signal };
      const compilePromise = dispatcher.compile(job);

      expect(worker.postMessage).toHaveBeenCalledTimes(1);

      controller.abort();

      await expect(compilePromise).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(worker.terminate).toHaveBeenCalledTimes(1);

      dispatcher.destroy();
    });

    it('处理 worker 错误', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockWorker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => mockWorker,
      });

      const job = createMockJob();
      const compilePromise = dispatcher.compile(job);

      setTimeout(() => {
        mockWorker.simulateError(new Error('Worker error'));
      }, 10);

      await expect(compilePromise).rejects.toThrow();
    });
  });

  describe('destroy', () => {
    it('终止 worker 并拒绝待处理的请求', async () => {
      const { createBucketTileDispatcher } = await import('@/mvt/bucket');

      const mockWorker = createMockWorker();
      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => mockWorker,
      });

      const job = createMockJob();
      const compilePromise = dispatcher.compile(job);

      dispatcher.destroy();

      expect(mockWorker.terminate).toHaveBeenCalled();
      await expect(compilePromise).rejects.toThrow('destroyed');
    });
  });
});

function createMockWorker() {
  const listeners = {
    error: [] as Array<(event: unknown) => void>,
    message: [] as Array<(event: unknown) => void>,
  };

  return {
    addEventListener: vi.fn((type: 'error' | 'message', listener: (event: unknown) => void) => {
      listeners[type].push(listener);
    }),
    postMessage: vi.fn(),
    removeEventListener: vi.fn((type: 'error' | 'message', listener: (event: unknown) => void) => {
      const index = listeners[type].indexOf(listener);
      if (index > -1) {
        listeners[type].splice(index, 1);
      }
    }),
    simulateError: (error: Error) => {
      listeners.error.forEach(listener => listener(error));
    },
    simulateMessage: (data: any) => {
      listeners.message.forEach(listener => listener({ data }));
    },
    terminate: vi.fn(),
  };
}

function createSequentialWorkerFactory(
  workers: Array<ReturnType<typeof createMockWorker>>,
) {
  let index = 0;

  return () => {
    const worker = workers[index];
    index += 1;
    return worker;
  };
}

function createMockJob(overrides: Partial<ReturnType<typeof createMockJobBase>> = {}) {
  return {
    ...createMockJobBase(),
    ...overrides,
  };
}

function createMockJobBase() {
  return {
    renderTile: {
      epoch: 1,
      key: 'source/0/0/0',
      sourceId: 'source',
      batches: [],
      geometryBatches: [],
    },
    style: createMockStyle('fill'),
    tileData: new ArrayBuffer(0),
    tilingScheme: {
      tileXYToNativeRectangle: () => ({
        west: -20037508.342789244,
        south: -20037508.342789244,
        east: 20037508.342789244,
        north: 20037508.342789244,
      }),
      tileXYToRectangle: () => ({
        west: -Math.PI,
        south: -Math.PI / 2,
        east: Math.PI,
        north: Math.PI / 2,
      }),
    } as any,
  };
}
