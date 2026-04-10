import type { FeatureTile } from '../render/feature-tile';
import type { RenderTile } from '../render/render-tile';
import { compileFeatureTile } from '../render/feature-tile';
import { parseVectorTile } from '../source/vector-tile';
import { createAbortError } from '../utils/abort';

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

export interface FeatureTileCancelMessage {
  id: number;
  type: 'cancel-feature-tile';
}

export type FeatureTileWorkerMessage
  = | FeatureTileCancelMessage
    | FeatureTileCompileMessage;
export type FeatureTileWorkerResponse
  = | FeatureTileErrorResponse
    | FeatureTileResultResponse;

interface FeatureTileWorkerLike {
  addEventListener: (
    type: 'error' | 'message',
    listener: (event: unknown) => void,
  ) => void;
  postMessage: (message: FeatureTileWorkerMessage) => void;
  removeEventListener: (
    type: 'error' | 'message',
    listener: (event: unknown) => void,
  ) => void;
  terminate: () => void;
}

export interface FeatureTileDispatcherOptions {
  workerFactory?: () => FeatureTileWorkerLike | undefined;
}

interface PendingRequest {
  cleanupAbortListener?: () => void;
  reject: (error: unknown) => void;
  resolve: (featureTile: FeatureTile) => void;
}

export interface FeatureTileDispatcher {
  compile: (job: CompileFeatureTileJob) => Promise<FeatureTile>;
  destroy: () => void;
}

class WorkerFeatureTileDispatcher implements FeatureTileDispatcher {
  private destroyed = false;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly worker: FeatureTileWorkerLike;

  constructor(worker: FeatureTileWorkerLike) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  compile(job: CompileFeatureTileJob): Promise<FeatureTile> {
    if (this.destroyed) {
      return Promise.reject(new Error('Feature tile dispatcher has been destroyed.'));
    }

    if (job.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const featureTilePromise = new Promise<FeatureTile>((resolve, reject) => {
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
        type: 'cancel-feature-tile',
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

    this.worker.postMessage({
      id,
      renderTile: job.renderTile,
      tileData: job.tileData,
      type: 'compile-feature-tile',
    });
    return featureTilePromise;
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
      pendingRequest.reject(new Error('Feature tile dispatcher has been destroyed.'));
    }
    this.pendingRequests.clear();
  }

  private readonly handleError = (event: unknown): void => {
    const error = event instanceof Error
      ? event
      : new Error('Feature tile worker failed.');

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
    if (data.type === 'feature-tile-result') {
      pendingRequest.resolve(data.featureTile);
      return;
    }

    pendingRequest.reject(new Error(data.error));
  };
}

class InlineFeatureTileDispatcher implements FeatureTileDispatcher {
  compile(job: CompileFeatureTileJob): Promise<FeatureTile> {
    if (job.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return Promise.resolve(compileFeatureTile({
      renderTile: job.renderTile,
      tile: parseVectorTile(job.tileData),
    }));
  }

  destroy(): void {}
}

export function createFeatureTileDispatcher(
  options: FeatureTileDispatcherOptions = {},
): FeatureTileDispatcher {
  const workerFactory = options.workerFactory ?? createDefaultWorker;
  const worker = workerFactory();
  if (!worker) {
    return new InlineFeatureTileDispatcher();
  }

  return new WorkerFeatureTileDispatcher(worker);
}

function createDefaultWorker(): FeatureTileWorkerLike | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }

  return new Worker(
    new URL('./feature-tile.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  ) as unknown as FeatureTileWorkerLike;
}

function extractWorkerResponse(event: unknown): FeatureTileWorkerResponse {
  if (
    event
    && typeof event === 'object'
    && 'data' in event
  ) {
    return (event as { data: FeatureTileWorkerResponse }).data;
  }

  throw new TypeError('Invalid feature tile worker event.');
}
