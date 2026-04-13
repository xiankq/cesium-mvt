import type { WorkerLike } from '../utils/worker-dispatcher';
import type { FeatureTile } from './feature-tile';
import type { RenderTile } from './render-tile';
import { parseVectorTile } from '../source/vector-tile';
import { formatErrorMessage } from '../utils/common';
import {
  extractWorkerResponse,
  InlineDispatcher,
} from '../utils/worker-dispatcher';
import { WorkerPoolDispatcher } from '../utils/worker-pool-dispatcher';
import { compileFeatureTile } from './feature-tile';

/**
 * Feature 瓦片 Dispatcher 模块
 *
 * 该模块负责管理 Feature 瓦片的编译任务分发，支持 Worker 和内联两种执行模式。
 *
 * 核心概念：
 * - Worker 模式：在 Web Worker 中异步编译，不阻塞主线程
 * - Inline 模式：在主线程中同步编译，适用于不支持 Worker 的环境
 */

export interface CompileFeatureTileJob {
  renderTile: RenderTile;
  signal?: AbortSignal;
  tileData: ArrayBuffer;
}

export interface FeatureTileResultResponse {
  featureTile: FeatureTile;
  id: number;
  type: 'feature-tile-result';
}

export interface FeatureTileErrorResponse {
  error: string;
  id: number;
  type: 'feature-tile-error';
}

export interface FeatureTileCompileMessage extends CompileFeatureTileJob {
  id: number;
  type: 'compile-feature-tile';
}

export type FeatureTileWorkerMessage = FeatureTileCompileMessage;
export type FeatureTileWorkerResponse
  = | FeatureTileErrorResponse
    | FeatureTileResultResponse;

export interface FeatureTileDispatcherOptions {
  workerFactory?: () => WorkerLike<FeatureTileWorkerMessage> | undefined;
}

export interface FeatureTileDispatcher {
  compile: (job: CompileFeatureTileJob) => Promise<FeatureTile>;
  destroy: () => void;
}

/**
 * 创建 Feature 瓦片 Dispatcher
 *
 * @param options - 配置选项
 * @returns Feature 瓦片 Dispatcher 实例
 */
export function createFeatureTileDispatcher(
  options: FeatureTileDispatcherOptions = {},
): FeatureTileDispatcher {
  const workerFactory = options.workerFactory ?? createDefaultWorker;

  const dispatcher = new WorkerPoolDispatcher<
    CompileFeatureTileJob,
    FeatureTile,
    FeatureTileWorkerMessage
  >({
    createJobMessage: (id, job) => ({
      message: {
        id,
        renderTile: job.renderTile,
        tileData: job.tileData,
        type: 'compile-feature-tile',
      },
    }),
    dispatcherName: 'Feature tile dispatcher',
    extractResult: (event) => {
      const data = extractWorkerResponse<FeatureTileWorkerResponse>(event);
      if (data.type === 'feature-tile-result') {
        return { id: data.id, result: data.featureTile };
      }
      if (data.type === 'feature-tile-error') {
        throw new Error(formatErrorMessage(data.error, 'Feature tile worker failed.'));
      }
      return null;
    },
    workerCount: 1,
    workerFactory,
  });

  if (!dispatcher.hasWorkers()) {
    return new InlineDispatcher({
      execute: (job: CompileFeatureTileJob) => {
        return compileFeatureTile({
          renderTile: job.renderTile,
          tile: parseVectorTile(job.tileData),
        });
      },
    });
  }

  return {
    compile: (job: CompileFeatureTileJob) => dispatcher.dispatch(job, job.signal),
    destroy: () => dispatcher.destroy(),
  };
}

/**
 * 创建默认 Worker
 *
 * @returns Worker 实例，如果不支持则返回 undefined
 */
function createDefaultWorker(): WorkerLike<FeatureTileWorkerMessage> | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }

  return new Worker(
    new URL('../worker/feature-tile.worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as WorkerLike<FeatureTileWorkerMessage>;
}
