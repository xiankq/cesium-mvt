import { describe, expect, it, vi } from 'vitest';
import {
  configureRequestScheduler,
  createTileRequest,
  getRequestSchedulerStats,
  scheduleTileRequest,
} from '@/mvt/source/request-scheduler';

vi.mock('cesium', () => {
  const mockFetchArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));

  return {
    Request: class Request {
      cancelFunction?: () => void;
      priority = 0;
      throttle = false;
      throttleByServer = false;
      type = 0;

      constructor(options: {
        cancelFunction?: () => void;
        priority?: number;
        throttle?: boolean;
        throttleByServer?: boolean;
        type?: number;
      }) {
        this.cancelFunction = options.cancelFunction;
        this.priority = options.priority ?? 0;
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
    },
    RequestScheduler: {
      maximumRequests: 50,
      maximumRequestsPerServer: 18,
      throttleRequests: true,
    },
    RequestType: {
      TILES3D: 2,
    },
  };
});

describe('request-scheduler', () => {
  describe('createTileRequest', () => {
    it('创建瓦片请求', () => {
      const cancelFunction = vi.fn();

      const request = createTileRequest({
        cancelFunction,
        priority: 10,
        url: 'https://example.com/tile.pbf',
      });

      expect(request.priority).toBe(10);
      expect(request.throttle).toBe(true);
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
  });

  describe('scheduleTileRequest', () => {
    it('调度瓦片请求', async () => {
      const result = await scheduleTileRequest({
        priority: 5,
        url: 'https://example.com/tile.pbf',
      });

      expect(result).toBeInstanceOf(ArrayBuffer);
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
