import { describe, expect, it, vi } from 'vitest';

describe('bucket-tile-dispatcher', () => {
  describe('createBucketTileDispatcher', () => {
    it('should create dispatcher with inline mode when worker factory returns undefined', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      expect(dispatcher).toBeDefined();
      expect(dispatcher.compile).toBeInstanceOf(Function);
      expect(dispatcher.destroy).toBeInstanceOf(Function);
    });

    it('should create dispatcher with worker mode when worker factory returns worker', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

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
    it('should compile bucket tile in inline mode', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      const job = createMockJob();
      const result = await dispatcher.compile(job);

      expect(result).toBeDefined();
      expect(result.buckets).toBeInstanceOf(Array);
      expect(result.key).toBe(job.renderTile.key);
    });

    it('should compile bucket tile in worker mode', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

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

    it('should reject when signal is already aborted', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      const controller = new AbortController();
      controller.abort();

      const job = { ...createMockJob(), signal: controller.signal };

      await expect(dispatcher.compile(job)).rejects.toThrow();
    });

    it('should reject when dispatcher is destroyed', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

      const dispatcher = createBucketTileDispatcher({
        workerFactory: () => undefined,
      });

      dispatcher.destroy();

      const job = createMockJob();
      await expect(dispatcher.compile(job)).rejects.toThrow('destroyed');
    });

    it('should handle worker error', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

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
    it('should terminate worker and reject pending requests', async () => {
      const { createBucketTileDispatcher } = await import('../../../../src/mvt/worker/bucket-tile-dispatcher');

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

function createMockJob() {
  return {
    renderTile: {
      epoch: 1,
      key: 'source/0/0/0',
      sourceId: 'source',
      batches: [],
      geometryBatches: [],
    },
    tileData: new ArrayBuffer(0),
    tilingScheme: {
      tileXYToRectangle: () => ({
        west: -Math.PI,
        south: -Math.PI / 2,
        east: Math.PI,
        north: Math.PI / 2,
      }),
    } as any,
  };
}
