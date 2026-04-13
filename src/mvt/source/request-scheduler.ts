import { Request, RequestScheduler, RequestType, Resource } from 'cesium';
import { createAbortError } from '../utils/common';

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

  /**
   * 请求中断信号
   */
  signal?: AbortSignal;
}

interface RequestOptionsBase {
  cancelFunction?: () => void;
  priority?: number;
  serverKey?: string;
  signal?: AbortSignal;
  url: string;
}

interface RequestSchedulerRuntime {
  getServerKey: (url: string) => string;
}

/**
 * 创建瓦片请求
 *
 * 使用 Cesium 的 Request 进行请求调度
 */
export function createTileRequest(options: TileRequestOptions): Request {
  return createRequest(options, RequestType.TILES3D);
}

/**
 * 调度 JSON 请求
 *
 * 使用 Cesium 的 Resource 和 RequestScheduler 进行请求调度
 */
export function scheduleJsonRequest(options: TileRequestOptions): Promise<any> {
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const request = createRequest(options, RequestType.OTHER);
  const resource = new Resource({
    request,
    url: options.url,
  });

  return scheduleResourceRequest({
    request,
    signal: options.signal,
    start: () => resource.fetchJson(),
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
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const request = createTileRequest(options);
  const resource = new Resource({
    request,
    url: options.url,
  });

  return scheduleResourceRequest({
    request,
    signal: options.signal,
    start: () => resource.fetchArrayBuffer(),
  });
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

export function isThrottleError(error: unknown): boolean {
  return error instanceof Error && error.name === 'RequestThrottledError';
}

function createRequest(
  options: RequestOptionsBase,
  type: RequestType,
): Request {
  const scheduler = RequestScheduler as unknown as RequestSchedulerRuntime;
  const resolvedServerKey = options.serverKey ?? scheduler.getServerKey(options.url);
  const request = new Request({
    cancelFunction: options.cancelFunction,
    priority: options.priority ?? 0,
    serverKey: resolvedServerKey,
    throttle: true,
    throttleByServer: resolvedServerKey !== undefined,
    type,
    url: options.url,
  });
  return request;
}

function scheduleResourceRequest<T>(options: {
  request: Request;
  signal?: AbortSignal;
  start: () => Promise<T> | undefined;
}): Promise<T> {
  const cleanup = bindAbortSignal(options.request, options.signal);
  let promise: Promise<T> | undefined;

  try {
    promise = options.start();
  }
  catch (error) {
    cleanup?.();
    return Promise.reject(error);
  }

  if (!promise) {
    cleanup?.();
    return Promise.reject(createThrottleError());
  }

  return promise.finally(() => {
    cleanup?.();
  });
}

function bindAbortSignal(
  request: Request,
  signal?: AbortSignal,
): (() => void) | undefined {
  if (!signal) {
    return undefined;
  }

  const scheduledRequest = request as Request & { cancelled?: boolean };
  const onAbort = () => {
    scheduledRequest.cancelled = true;
    scheduledRequest.cancelFunction?.();
  };

  signal.addEventListener('abort', onAbort, {
    once: true,
  });

  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

export function createThrottleError(): Error {
  return Object.assign(new Error('request throttled'), {
    name: 'RequestThrottledError',
  });
}
