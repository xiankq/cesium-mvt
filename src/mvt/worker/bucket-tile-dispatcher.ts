import type { WebMercatorTilingScheme } from 'cesium';
import type { RenderTile } from '../render/render-tile';
import type { ParsedTileResult } from './bucket/bucket-types';
import type { TileProjectionData } from './geometry/tile-projection';
import { createAbortError } from '../utils/abort';
import { compileBucketTileFromData } from './bucket-tile-compiler';

export interface CompileBucketTileJob {
  renderTile: RenderTile;
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
  tileData: ArrayBuffer;
  tileProjection: TileProjectionData;
  type: 'compile-bucket-tile';
}

export interface BucketTileCancelMessage {
  id: number;
  type: 'cancel-bucket-tile';
}

export type BucketTileWorkerMessage
  = | BucketTileCancelMessage
    | BucketTileCompileMessage;
export type BucketTileWorkerResponse
  = | BucketTileErrorResponse
    | BucketTileResultResponse;

interface BucketTileWorkerLike {
  addEventListener: (
    type: 'error' | 'message',
    listener: (event: unknown) => void,
  ) => void;
  postMessage: (message: BucketTileWorkerMessage, transfer?: Transferable[]) => void;
  removeEventListener: (
    type: 'error' | 'message',
    listener: (event: unknown) => void,
  ) => void;
  terminate: () => void;
}

export interface BucketTileDispatcherOptions {
  workerFactory?: () => BucketTileWorkerLike | undefined;
}

interface PendingRequest {
  cleanupAbortListener?: () => void;
  reject: (error: unknown) => void;
  resolve: (bucketTile: ParsedTileResult) => void;
}

export interface BucketTileDispatcher {
  compile: (job: CompileBucketTileJob) => Promise<ParsedTileResult>;
  destroy: () => void;
}

class WorkerBucketTileDispatcher implements BucketTileDispatcher {
  private destroyed = false;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly worker: BucketTileWorkerLike;

  constructor(worker: BucketTileWorkerLike) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  compile(job: CompileBucketTileJob): Promise<ParsedTileResult> {
    if (this.destroyed) {
      return Promise.reject(new Error('Bucket tile dispatcher has been destroyed.'));
    }

    if (job.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const bucketTilePromise = new Promise<ParsedTileResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        reject,
        resolve,
      });
    });
    const abortListener = () => {
      const pendingRequest = this.pendingRequests.get(id);
      if (!pendingRequest) {
        return;
      }

      this.pendingRequests.delete(id);
      pendingRequest.cleanupAbortListener?.();
      this.worker.postMessage({
        id,
        type: 'cancel-bucket-tile',
      });
      pendingRequest.reject(createAbortError());
    };
    if (job.signal) {
      job.signal.addEventListener('abort', abortListener, { once: true });
      const pendingRequest = this.pendingRequests.get(id);
      if (pendingRequest) {
        pendingRequest.cleanupAbortListener = () => {
          job.signal?.removeEventListener('abort', abortListener);
        };
      }
    }

    const tileProjection = extractTileProjection(job.renderTile.key, job.tilingScheme);

    this.worker.postMessage({
      id,
      renderTile: job.renderTile,
      tileData: job.tileData,
      tileProjection,
      type: 'compile-bucket-tile',
    }, [job.tileData]);
    return bucketTilePromise;
  }

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
      pendingRequest.reject(new Error('Bucket tile dispatcher has been destroyed.'));
    }
    this.pendingRequests.clear();
  }

  private readonly handleError = (event: unknown): void => {
    const error = event instanceof Error
      ? event
      : new Error('Bucket tile worker failed.');

    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.cleanupAbortListener?.();
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  };

  private readonly handleMessage = (event: unknown): void => {
    const data = extractWorkerResponse(event);
    const pendingRequest = this.pendingRequests.get(data.id);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(data.id);
    pendingRequest.cleanupAbortListener?.();
    if (data.type === 'bucket-tile-result') {
      pendingRequest.resolve(data.bucketTile);
      return;
    }

    pendingRequest.reject(new Error(data.error));
  };
}

class InlineBucketTileDispatcher implements BucketTileDispatcher {
  private destroyed = false;

  compile(job: CompileBucketTileJob): Promise<ParsedTileResult> {
    if (this.destroyed) {
      return Promise.reject(new Error('Bucket tile dispatcher has been destroyed.'));
    }

    if (job.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const tileProjection = extractTileProjection(job.renderTile.key, job.tilingScheme);
    return Promise.resolve(compileBucketTileFromData({
      renderTile: job.renderTile,
      tileData: job.tileData,
      tileProjection,
    }));
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export function createBucketTileDispatcher(
  options: BucketTileDispatcherOptions = {},
): BucketTileDispatcher {
  const workerFactory = options.workerFactory ?? createDefaultWorker;
  const worker = workerFactory();
  if (!worker) {
    return new InlineBucketTileDispatcher();
  }

  return new WorkerBucketTileDispatcher(worker);
}

function createDefaultWorker(): BucketTileWorkerLike | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }

  return new Worker(
    new URL('./bucket-tile.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  ) as unknown as BucketTileWorkerLike;
}

function extractWorkerResponse(event: unknown): BucketTileWorkerResponse {
  if (
    event
    && typeof event === 'object'
    && 'data' in event
  ) {
    return (event as { data: BucketTileWorkerResponse }).data;
  }

  throw new TypeError('Invalid bucket tile worker event.');
}

function extractTileProjection(
  tileKey: string,
  tilingScheme: WebMercatorTilingScheme,
): TileProjectionData {
  const { level, x, y } = parseTileCoordinateFromKey(tileKey);
  const rect = tilingScheme.tileXYToNativeRectangle(x, y, level);
  return {
    east: rect.east,
    north: rect.north,
    south: rect.south,
    west: rect.west,
  };
}

function parseTileCoordinateFromKey(key: string) {
  const scopedKey = key.split('@')[0];
  const parts = scopedKey.split('/');

  if (parts.length < 4) {
    return { level: 0, x: 0, y: 0 };
  }

  const level = Number(parts[parts.length - 3]);
  const x = Number(parts[parts.length - 2]);
  const y = Number(parts[parts.length - 1]);

  if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return { level: 0, x: 0, y: 0 };
  }

  return { level, x, y };
}
