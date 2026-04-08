import type { DecodedTileRecord, TileDecodeJob } from '../types';
import type { WorkerDecodeRequest, WorkerRequest, WorkerResponse } from './protocol';
import { resolveHardwareConcurrency } from '../utils';
import { createTileDecodeAbortError,

} from './protocol';

interface PendingJob {
  resolve: (tile: DecodedTileRecord) => void;
  reject: (error: Error) => void;
  workerIndex: number;
  tileId: string;
}

interface WorkerSlot {
  worker: Worker;
  pendingIds: Set<number>;
}

export interface VectorTileWorkerTask {
  promise: Promise<DecodedTileRecord>;
  cancel: () => boolean;
  requestId: number;
}

export class VectorTileWorkerClient {
  private readonly workers: WorkerSlot[];
  private readonly pending = new Map<number, PendingJob>();
  private requestId = 0;

  constructor(workerCount?: number) {
    const resolvedWorkerCount = Math.max(
      1,
      Math.min(4, Math.floor(workerCount ?? resolveHardwareConcurrency())),
    );
    this.workers = Array.from({ length: resolvedWorkerCount }, () => ({
      worker: new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      }),
      pendingIds: new Set<number>(),
    }));

    for (const [workerIndex, slot] of this.workers.entries()) {
      slot.worker.onmessage = (event) => {
        this.handleMessage(workerIndex, event);
      };
      slot.worker.onerror = (event) => {
        this.handleError(workerIndex, event);
      };
    }
  }

  decode(job: TileDecodeJob): VectorTileWorkerTask {
    const id = this.nextRequestId();
    const workerIndex = this.pickWorkerIndex();
    const slot = this.workers[workerIndex];

    const promise = new Promise<DecodedTileRecord>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        workerIndex,
        tileId: job.id,
      });
      slot.pendingIds.add(id);

      const message: WorkerDecodeRequest = {
        id,
        kind: 'decode',
        job,
      };

      slot.worker.postMessage(message satisfies WorkerRequest);
    });

    return {
      requestId: id,
      promise,
      cancel: () => this.cancel(id),
    };
  }

  cancel(requestId: number): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return false;
    }

    this.pending.delete(requestId);
    this.workers[pending.workerIndex]?.pendingIds.delete(requestId);
    pending.reject(createTileDecodeAbortError(pending.tileId));
    this.workers[pending.workerIndex]?.worker.postMessage({
      id: requestId,
      kind: 'cancel',
    } satisfies WorkerRequest);
    return true;
  }

  destroy(): void {
    for (const slot of this.workers) {
      slot.worker.terminate();
    }

    for (const [requestId, pending] of this.pending.entries()) {
      this.workers[pending.workerIndex]?.pendingIds.delete(requestId);
      pending.reject(new Error('Vector tile worker was terminated.'));
    }

    this.pending.clear();
  }

  private nextRequestId(): number {
    let nextId = this.requestId;

    do {
      nextId += 1;
      if (nextId >= Number.MAX_SAFE_INTEGER) {
        nextId = 1;
      }
    } while (this.pending.has(nextId));

    this.requestId = nextId;
    return nextId;
  }

  private pickWorkerIndex(): number {
    let selectedIndex = 0;
    let minPendingCount = Number.POSITIVE_INFINITY;

    for (const [index, slot] of this.workers.entries()) {
      if (slot.pendingIds.size < minPendingCount) {
        selectedIndex = index;
        minPendingCount = slot.pendingIds.size;
      }
    }

    return selectedIndex;
  }

  private handleMessage(workerIndex: number, event: MessageEvent<WorkerResponse>): void {
    const message = event.data;
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    this.workers[workerIndex]?.pendingIds.delete(message.id);

    if (message.ok) {
      pending.resolve(message.tile);
      return;
    }

    pending.reject(new Error(message.error));
  }

  private handleError(workerIndex: number, event: ErrorEvent): void {
    const error = new Error(event.message);
    const slot = this.workers[workerIndex];
    if (!slot) {
      return;
    }

    for (const requestId of Array.from(slot.pendingIds)) {
      const pending = this.pending.get(requestId);
      if (!pending) {
        continue;
      }

      this.pending.delete(requestId);
      pending.reject(error);
    }

    slot.pendingIds.clear();
  }
}
