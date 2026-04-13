import { Request, RequestScheduler, RequestType, Resource } from 'cesium';

/**
 * 请求调度器选项
 */
export interface RequestSchedulerOptions {
  /**
   * 最大并发请求数
   */
  maximumRequests?: number;

  /**
   * 每个服务器最大并发请求数
   */
  maximumRequestsPerServer?: number;
}

/**
 * 瓦片请求选项
 */
export interface TileRequestOptions {
  /**
   * 请求 URL
   */
  url: string;

  /**
   * 请求优先级（数值越小优先级越高）
   */
  priority?: number;

  /**
   * 取消函数
   */
  cancelFunction?: () => void;

  /**
   * 服务器标识
   */
  serverKey?: string;
}

/**
 * 创建瓦片请求
 *
 * 使用 Cesium 的 Request 进行请求调度
 */
export function createTileRequest(options: TileRequestOptions): Request {
  const {
    priority = 0,
    cancelFunction,
    serverKey,
  } = options;

  return new Request({
    cancelFunction,
    priority,
    throttle: true,
    throttleByServer: !!serverKey,
    type: RequestType.TILES3D,
  });
}

/**
 * 调度瓦片请求
 *
 * 使用 Cesium 的 Resource 和 RequestScheduler 进行请求调度
 *
 * @param options 请求选项
 * @returns 请求 Promise
 */
export function scheduleTileRequest(options: TileRequestOptions): Promise<ArrayBuffer> {
  const { url } = options;

  const request = createTileRequest(options);

  const resource = new Resource({
    request,
    url,
  });

  const result = resource.fetchArrayBuffer();

  if (!result) {
    return Promise.reject(new Error('Request was throttled'));
  }

  return result;
}

/**
 * 配置请求调度器
 */
export function configureRequestScheduler(options: RequestSchedulerOptions): void {
  if (options.maximumRequests !== undefined) {
    RequestScheduler.maximumRequests = options.maximumRequests;
  }

  if (options.maximumRequestsPerServer !== undefined) {
    RequestScheduler.maximumRequestsPerServer = options.maximumRequestsPerServer;
  }
}

/**
 * 获取请求调度器统计信息
 */
export function getRequestSchedulerStats() {
  return {
    maximumRequests: RequestScheduler.maximumRequests,
    maximumRequestsPerServer: RequestScheduler.maximumRequestsPerServer,
    throttleRequests: RequestScheduler.throttleRequests,
  };
}
