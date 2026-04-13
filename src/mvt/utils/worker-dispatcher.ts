import { createAbortError } from './common';

/**
 * Worker Dispatcher 通用工具模块
 *
 * 该模块提供了通用的 Worker 相关辅助类型和内联执行器。
 *
 * 核心概念：
 * - WorkerLike: Worker 的通用接口定义
 * - InlineDispatcher: 通用的内联 Dispatcher 实现
 *
 * 使用方式：
 * 1. 定义消息类型和响应类型
 * 2. 使用 InlineDispatcher 或自行组合 Worker 逻辑
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
