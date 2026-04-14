import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { WebMercatorTilingScheme } from 'cesium';
import type { TileProjectionData } from '../geometry/tile-projection';
import type { RenderTile } from '../render/render-tile';
import type { WorkerLike } from '../utils/worker-dispatcher';
import type { ParsedTileResult } from './bucket-types';
import { parseRenderTileCoordinateFromKey } from '../render/render-tile';
import { formatErrorMessage } from '../utils/common';
import {
  extractWorkerResponse,
  InlineDispatcher,
} from '../utils/worker-dispatcher';
import { WorkerPoolDispatcher } from '../utils/worker-pool-dispatcher';
import { compileBucketTileFromData } from './bucket-tile-compiler';

/**
 * Bucket 瓦片 Dispatcher 模块
 *
 * 该模块负责管理 Bucket 瓦片的编译任务分发，支持 Worker 和内联两种执行模式。
 *
 * 核心概念：
 * - Worker 模式：在 Web Worker 中异步编译，不阻塞主线程
 * - Inline 模式：在主线程中同步编译，适用于不支持 Worker 的环境
 */

export interface CompileBucketTileJob {
  renderTile: RenderTile;
  style: StyleSpecification;
  signal?: AbortSignal;
  tileData: ArrayBuffer;
  tilingScheme: WebMercatorTilingScheme;
}

export interface BucketTileResultResponse {
  bucketTile: ParsedTileResult;
  id: number;
  type: 'bucket-tile-result';
}

export interface BucketTileErrorResponse {
  error: string;
  id: number;
  type: 'bucket-tile-error';
}

export interface BucketTileCompileMessage {
  id: number;
  renderTile: RenderTile;
  style: StyleSpecification;
  tileData: ArrayBuffer;
  tileProjection: TileProjectionData;
  type: 'compile-bucket-tile';
}

export type BucketTileWorkerMessage = BucketTileCompileMessage;
export type BucketTileWorkerResponse
  = | BucketTileErrorResponse
    | BucketTileResultResponse;

export interface BucketTileDispatcherOptions {
  workerFactory?: () => WorkerLike<BucketTileWorkerMessage, Transferable> | undefined;
}

export interface BucketTileDispatcher {
  compile: (job: CompileBucketTileJob) => Promise<ParsedTileResult>;
  destroy: () => void;
}

/**
 * 创建 Bucket 瓦片 Dispatcher
 *
 * @param options - 配置选项
 * @returns Bucket 瓦片 Dispatcher 实例
 */
export function createBucketTileDispatcher(
  options: BucketTileDispatcherOptions = {},
): BucketTileDispatcher {
  const workerFactory = options.workerFactory ?? createDefaultWorker;
  const dispatcher = new WorkerPoolDispatcher<
    CompileBucketTileJob,
    ParsedTileResult,
    BucketTileWorkerMessage,
    Transferable
  >({
    createJobMessage: (id, job) => {
      const tileProjection = extractTileProjection(job.renderTile.key, job.tilingScheme);
      return {
        message: {
          id,
          renderTile: job.renderTile,
          style: job.style,
          tileData: job.tileData,
          tileProjection,
          type: 'compile-bucket-tile',
        },
        transfer: [job.tileData],
      };
    },
    dispatcherName: 'Bucket tile dispatcher',
    extractResult: (event) => {
      const data = extractWorkerResponse<BucketTileWorkerResponse>(event);
      if (data.type === 'bucket-tile-result') {
        return { id: data.id, result: data.bucketTile };
      }
      if (data.type === 'bucket-tile-error') {
        throw new Error(formatErrorMessage(data.error, 'Bucket tile worker failed.'));
      }
      return null;
    },
    workerFactory,
  });

  if (!dispatcher.hasWorkers()) {
    return new InlineDispatcher({
      execute: (job: CompileBucketTileJob) => {
        const tileProjection = extractTileProjection(job.renderTile.key, job.tilingScheme);
        return compileBucketTileFromData({
          renderTile: job.renderTile,
          style: job.style,
          tileData: job.tileData,
          tileProjection,
        });
      },
    });
  }

  return {
    compile: (job: CompileBucketTileJob) => dispatcher.dispatch(job, job.signal),
    destroy: () => dispatcher.destroy(),
  };
}

/**
 * 创建默认 Worker
 *
 * @returns Worker 实例，如果不支持则返回 undefined
 */
function createDefaultWorker(): WorkerLike<BucketTileWorkerMessage, Transferable> | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }

  return new Worker(
    new URL('../worker/bucket-tile.worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as WorkerLike<BucketTileWorkerMessage, Transferable>;
}

/**
 * 提取瓦片投影数据
 *
 * @param tileKey - 瓦片键
 * @param tilingScheme - 瓦片方案
 * @returns 瓦片投影数据
 */
function extractTileProjection(
  tileKey: string,
  tilingScheme: WebMercatorTilingScheme,
): TileProjectionData {
  let level = 0;
  let x = 0;
  let y = 0;

  try {
    ({ level, x, y } = parseRenderTileCoordinateFromKey(tileKey));
  }
  catch {
    // 保持旧行为：坐标无法解析时回落到默认瓦片原点。
  }

  const rect = tilingScheme.tileXYToNativeRectangle(x, y, level);
  return {
    east: rect.east,
    north: rect.north,
    south: rect.south,
    west: rect.west,
  };
}
