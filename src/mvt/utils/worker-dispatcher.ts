import { createAbortError } from './common';

/**
 * Worker Dispatcher 通用工具模块
 *
 * 该模块提供了通用的 Worker Dispatcher 实现，用于消除不同类型 dispatcher 之间的重复代码。
 *
 * 核心概念：
 * - WorkerLike: Worker 的通用接口定义
 * - PendingRequest: 待处理请求的通用结构
 * - WorkerDispatcher: 通用的 Worker Dispatcher 实现
 * - InlineDispatcher: 通用的内联 Dispatcher 实现
 *
 * 使用方式：
 * 1. 定义消息类型和响应类型
 * 2. 创建 WorkerDispatcher 实例，传入消息发送器和响应处理器
 * 3. 使用 dispatch 方法发送消息并等待响应
 */

/**
 * Worker 通用接口
 *
 * 定义了 Worker 需要实现的方法，用于消息传递和事件监听
 */
export interface WorkerLike<TMessage, TTransferable = never> {
  addEventListener: (
    type: 'error' | 'message',
    listener: (event: unknown) => void,
  ) => void;
  postMessage: (message: TMessage, transfer?: TTransferable[]) => void;
  removeEventListener: (
    type: 'error' | 'message',
    listener: (event: unknown) => void,
  ) => void;
  terminate: () => void;
}

/**
 * 待处理请求
 *
 * 存储请求的 resolve 和 reject 函数，以及清理函数
 */
export interface PendingRequest<TResult> {
  cleanupAbortListener?: () => void;
  reject: (error: unknown) => void;
  resolve: (result: TResult) => void;
}

/**
 * Worker Dispatcher 配置选项
 */
export interface WorkerDispatcherOptions<TJob, TResult, TMessage, TTransferable> {
  createCancelMessage: (id: number) => TMessage;
  createJobMessage: (id: number, job: TJob) => { message: TMessage; transfer?: TTransferable[] };
  dispatcherName: string;
  extractResult: (response: unknown) => { id: number; result: TResult } | null;
  worker: WorkerLike<TMessage, TTransferable>;
}

/**
 * Worker Dispatcher
 *
 * 通用的 Worker Dispatcher 实现，负责管理 Worker 通信和请求生命周期
 */
export class WorkerDispatcher<TJob, TResult, TMessage, TTransferable = never> {
  private destroyed = false;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest<TResult>>();
  private readonly worker: WorkerLike<TMessage, TTransferable>;
  private readonly options: WorkerDispatcherOptions<TJob, TResult, TMessage, TTransferable>;

  constructor(options: WorkerDispatcherOptions<TJob, TResult, TMessage, TTransferable>) {
    this.options = options;
    this.worker = options.worker;
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  /**
   * 分发任务到 Worker
   *
   * @param job - 任务描述
   * @param signal - 可选的中止信号
   * @returns 任务结果的 Promise
   */
  dispatch(job: TJob, signal?: AbortSignal): Promise<TResult> {
    if (this.destroyed) {
      return Promise.reject(new Error(`${this.options.dispatcherName} has been destroyed.`));
    }

    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const resultPromise = new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, { reject, resolve });
    });

    const abortListener = () => {
      const pendingRequest = this.pendingRequests.get(id);
      if (!pendingRequest) {
        return;
      }

      this.pendingRequests.delete(id);
      pendingRequest.cleanupAbortListener?.();
      this.worker.postMessage(this.options.createCancelMessage(id));
      pendingRequest.reject(createAbortError());
    };

    if (signal) {
      signal.addEventListener('abort', abortListener, { once: true });
      const pendingRequest = this.pendingRequests.get(id);
      if (pendingRequest) {
        pendingRequest.cleanupAbortListener = () => {
          signal.removeEventListener('abort', abortListener);
        };
      }
    }

    const { message, transfer } = this.options.createJobMessage(id, job);
    this.worker.postMessage(message, transfer);
    return resultPromise;
  }

  /**
   * 销毁 Dispatcher
   *
   * 清理所有资源，终止 Worker，拒绝所有待处理请求
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.worker.terminate();

    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.cleanupAbortListener?.();
      pendingRequest.reject(new Error(`${this.options.dispatcherName} has been destroyed.`));
    }
    this.pendingRequests.clear();
  }

  private readonly handleError = (event: unknown): void => {
    const error = event instanceof Error
      ? event
      : new Error(`${this.options.dispatcherName} worker failed.`);

    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.cleanupAbortListener?.();
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  };

  private readonly handleMessage = (event: unknown): void => {
    const extracted = this.options.extractResult(event);
    if (!extracted) {
      return;
    }

    const { id, result } = extracted;
    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(id);
    pendingRequest.cleanupAbortListener?.();
    pendingRequest.resolve(result);
  };
}

/**
 * Inline Dispatcher 配置选项
 */
export interface InlineDispatcherOptions<TJob, TResult> {
  execute: (job: TJob) => TResult;
}

/**
 * Inline Dispatcher
 *
 * 通用的内联 Dispatcher 实现，直接在主线程执行任务，不使用 Worker
 */
export class InlineDispatcher<TJob, TResult> {
  private destroyed = false;
  private readonly options: InlineDispatcherOptions<TJob, TResult>;

  constructor(options: InlineDispatcherOptions<TJob, TResult>) {
    this.options = options;
  }

  /**
   * 分发任务（内联执行）
   *
   * @param job - 任务描述
   * @param signal - 可选的中止信号
   * @returns 任务结果的 Promise
   */
  dispatch(job: TJob, signal?: AbortSignal): Promise<TResult> {
    if (this.destroyed) {
      return Promise.reject(new Error('Inline dispatcher has been destroyed.'));
    }

    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return Promise.resolve(this.options.execute(job));
  }

  /**
   * 执行任务（dispatch 的别名，用于兼容特定接口）
   *
   * @param job - 任务描述
   * @param signal - 可选的中止信号
   * @returns 任务结果的 Promise
   */
  compile(job: TJob, signal?: AbortSignal): Promise<TResult> {
    const actualSignal = signal ?? (job as any).signal;
    return this.dispatch(job, actualSignal);
  }

  /**
   * 销毁 Dispatcher
   */
  destroy(): void {
    this.destroyed = true;
  }
}

/**
 * 从 Worker 事件中提取响应数据
 *
 * @param event - Worker 事件
 * @returns 响应数据
 */
export function extractWorkerResponse<T>(event: unknown): T {
  if (typeof event !== 'object' || event === null) {
    throw new Error('Invalid worker response event.');
  }

  const eventWithMessage = event as { data?: unknown };
  if (!('data' in eventWithMessage)) {
    throw new Error('Worker response event missing data property.');
  }

  return eventWithMessage.data as T;
}
