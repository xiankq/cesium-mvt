import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureRequestScheduler,
  createTileRequest,
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
  describe('createTileRequest', () => {
    it('创建瓦片请求', () => {
      const cancelFunction = vi.fn();

      const request = createTileRequest({
        cancelFunction,
        priority: 10,
        serverKey: 'example.com:443',
        url: 'https://example.com/tile.pbf',
      });

      expect(request.priority).toBe(10);
      expect(request.throttle).toBe(true);
      expect(request.url).toBe('https://example.com/tile.pbf');
      expect((request as any).serverKey).toBe('example.com:443');
    });

    it('使用默认优先级', () => {
      const request = createTileRequest({
        url: 'https://example.com/tile.pbf',
      });

      expect(request.priority).toBe(0);
    });

    it('启用服务器节流', () => {
      const request = createTileRequest({
        serverKey: 'example.com:443',
        url: 'https://example.com/tile.pbf',
      });

      expect(request.throttleByServer).toBe(true);
    });

    it('使用 Cesium 的 serverKey 解析', async () => {
      const request = createTileRequest({
        url: '/tiles/2/1/3.pbf',
      });
      const { RequestScheduler } = await import('cesium');
      const mockedRequestScheduler = RequestScheduler as any;

      expect(mockedRequestScheduler.getServerKey).toHaveBeenCalledWith('/tiles/2/1/3.pbf');
      expect((request as any).serverKey).toBe('example.com:443');
      expect(request.throttleByServer).toBe(true);
    });

    it('不会注入自定义 priorityFunction', () => {
      const request = createTileRequest({
        priority: 8,
        url: 'https://example.com/tile.pbf',
      });

      expect(request.priority).toBe(8);
      expect(request.priorityFunction).toBeUndefined();
    });
  });

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
