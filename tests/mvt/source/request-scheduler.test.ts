import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureRequestScheduler,
  getRequestSchedulerStats,
  scheduleJsonRequest,
  scheduleTileRequest,
} from '@/mvt/source/request-scheduler';

vi.mock('cesium', () => {
  const mockFetchArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));

  return {
    Request: class Request {
      cancelFunction?: () => void;
      priorityFunction?: () => number;
      priority = 0;
      serverKey?: string;
      url = '';
      throttle = false;
      throttleByServer = false;
      type = 0;

      constructor(options: {
        cancelFunction?: () => void;
        priorityFunction?: () => number;
        priority?: number;
        serverKey?: string;
        url?: string;
        throttle?: boolean;
        throttleByServer?: boolean;
        type?: number;
      }) {
        this.cancelFunction = options.cancelFunction;
        this.priorityFunction = options.priorityFunction;
        this.priority = options.priority ?? 0;
        this.serverKey = options.serverKey;
        this.url = options.url ?? '';
        this.throttle = options.throttle ?? false;
        this.throttleByServer = options.throttleByServer ?? false;
        this.type = options.type ?? 0;
      }
    },
    Resource: class Resource {
      request?: unknown;
      url: string;

      constructor(options: { request?: unknown; url: string }) {
        this.request = options.request;
        this.url = options.url;
      }

      fetchArrayBuffer() {
        return mockFetchArrayBuffer();
      }

      fetchJson() {
        return Promise.resolve({ ok: true });
      }
    },
    RequestScheduler: {
      getServerKey: vi.fn(() => 'example.com:443'),
      maximumRequests: 50,
      maximumRequestsPerServer: 18,
      update: vi.fn(),
      throttleRequests: true,
    },
    RequestType: {
      OTHER: 3,
      TILES3D: 2,
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request-scheduler', () => {
  describe('scheduleTileRequest', () => {
    it('调度瓦片请求', async () => {
      const result = await scheduleTileRequest({
        priority: 5,
        url: 'https://example.com/tile.pbf',
      });

      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('在资源同步抛错时也会清理 abort 监听', async () => {
      const syncError = new Error('sync failure');
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();
      const signal = {
        aborted: false,
        addEventListener,
        removeEventListener,
      } as unknown as AbortSignal;
      const { Resource } = await import('cesium');

      vi.spyOn(Resource.prototype, 'fetchArrayBuffer').mockImplementation(() => {
        throw syncError;
      });

      await expect(scheduleTileRequest({
        signal,
        url: 'https://example.com/tile.pbf',
      })).rejects.toThrow(syncError);
      expect(addEventListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
        { once: true },
      );
      expect(removeEventListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('scheduleJsonRequest', () => {
    it('调度 JSON 请求', async () => {
      const result = await scheduleJsonRequest({
        priority: 3,
        url: 'https://example.com/tilejson.json',
      });

      expect(result).toMatchObject({ ok: true });
    });
  });

  describe('configureRequestScheduler', () => {
    it('配置最大并发请求数', () => {
      configureRequestScheduler({ maximumRequests: 100 });
      const stats = getRequestSchedulerStats();
      expect(stats.maximumRequests).toBe(100);
    });

    it('配置每服务器最大并发请求数', () => {
      configureRequestScheduler({ maximumRequestsPerServer: 20 });
      const stats = getRequestSchedulerStats();
      expect(stats.maximumRequestsPerServer).toBe(20);
    });
  });

  describe('getRequestSchedulerStats', () => {
    it('获取统计信息', () => {
      const stats = getRequestSchedulerStats();

      expect(stats).toHaveProperty('maximumRequests');
      expect(stats).toHaveProperty('maximumRequestsPerServer');
      expect(stats).toHaveProperty('throttleRequests');
    });
  });
});
