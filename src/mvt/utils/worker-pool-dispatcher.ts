import type { WorkerLike } from './worker-dispatcher';
import { createAbortError } from './common';

export interface WorkerPoolDispatcherOptions<TJob, TResult, TMessage, TTransferable> {
  createJobMessage: (id: number, job: TJob) => { message: TMessage; transfer?: TTransferable[] };
  dispatcherName: string;
  extractResult: (response: unknown) => { id: number; result: TResult } | null;
  workerCount?: number;
  workerFactory: () => WorkerLike<TMessage, TTransferable> | undefined;
}

interface WorkerPoolRequest<TJob, TResult> {
  cleanupAbortListener?: () => void;
  id: number;
  job: TJob;
  reject: (error: unknown) => void;
  resolve: (result: TResult) => void;
  signal?: AbortSignal;
  slotIndex?: number;
  state: 'active' | 'queued';
}

interface WorkerPoolSlot<TMessage, TTransferable> {
  activeRequestId?: number;
  errorListener?: (event: unknown) => void;
  messageListener?: (event: unknown) => void;
  worker?: WorkerLike<TMessage, TTransferable>;
}

export class WorkerPoolDispatcher<TJob, TResult, TMessage, TTransferable = never> {
  private destroyed = false;
  private nextRequestId = 1;
  private readonly liveWorkers = new Set<WorkerLike<TMessage, TTransferable>>();
  private readonly queuedRequests: WorkerPoolRequest<TJob, TResult>[] = [];
  private readonly requestRecords = new Map<number, WorkerPoolRequest<TJob, TResult>>();
  private readonly slots: WorkerPoolSlot<TMessage, TTransferable>[];
  private readonly options: WorkerPoolDispatcherOptions<TJob, TResult, TMessage, TTransferable>;

  constructor(options: WorkerPoolDispatcherOptions<TJob, TResult, TMessage, TTransferable>) {
    this.options = options;
    const workerCount = Math.max(1, options.workerCount ?? 2);
    this.slots = Array.from({ length: workerCount }, () => ({}));

    for (let index = 0; index < this.slots.length; index += 1) {
      this.ensureWorker(index);
    }
  }

  hasWorkers(): boolean {
    return this.slots.some(slot => slot.worker !== undefined);
  }

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
      const request: WorkerPoolRequest<TJob, TResult> = {
        id,
        job,
        reject,
        resolve,
        signal,
        state: 'queued',
      };

      this.requestRecords.set(id, request);
      this.queuedRequests.push(request);
      this.bindAbortListener(request);
      this.flushQueue();
    });

    return resultPromise;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    for (const slotIndex of this.slots.keys()) {
      this.releaseWorker(slotIndex, true);
    }

    const destroyedError = new Error(`${this.options.dispatcherName} has been destroyed.`);
    for (const request of this.requestRecords.values()) {
      request.cleanupAbortListener?.();
      request.reject(destroyedError);
    }

    this.requestRecords.clear();
    this.queuedRequests.length = 0;
    this.liveWorkers.clear();
  }

  private bindAbortListener(request: WorkerPoolRequest<TJob, TResult>): void {
    if (!request.signal) {
      return;
    }

    const abortListener = () => {
      this.abortRequest(request.id);
    };

    request.signal.addEventListener('abort', abortListener, { once: true });
    request.cleanupAbortListener = () => {
      request.signal?.removeEventListener('abort', abortListener);
    };
  }

  private abortRequest(requestId: number): void {
    const request = this.requestRecords.get(requestId);
    if (!request) {
      return;
    }

    if (request.state === 'queued') {
      this.removeQueuedRequest(requestId);
      this.settleRequest(request, createAbortError(), false);
      return;
    }

    const slotIndex = request.slotIndex;
    if (slotIndex === undefined) {
      this.settleRequest(request, createAbortError(), false);
      return;
    }

    this.releaseWorker(slotIndex, true);
    this.settleRequest(request, createAbortError(), false);
    this.flushQueue();
  }

  private ensureWorker(slotIndex: number): boolean {
    if (this.destroyed) {
      return false;
    }

    const slot = this.slots[slotIndex];
    if (!slot || slot.worker) {
      return slot?.worker !== undefined;
    }

    const worker = this.options.workerFactory();
    if (!worker || this.liveWorkers.has(worker)) {
      return false;
    }

    const messageListener = (event: unknown) => {
      this.handleWorkerMessage(slotIndex, event);
    };
    const errorListener = (event: unknown) => {
      this.handleWorkerError(slotIndex, event);
    };

    worker.addEventListener('message', messageListener);
    worker.addEventListener('error', errorListener);

    slot.worker = worker;
    slot.messageListener = messageListener;
    slot.errorListener = errorListener;
    this.liveWorkers.add(worker);
    return true;
  }

  private releaseWorker(slotIndex: number, terminateWorker: boolean): void {
    const slot = this.slots[slotIndex];
    const worker = slot?.worker;
    if (!slot || !worker) {
      return;
    }

    if (slot.messageListener) {
      worker.removeEventListener('message', slot.messageListener);
    }
    if (slot.errorListener) {
      worker.removeEventListener('error', slot.errorListener);
    }

    this.liveWorkers.delete(worker);
    slot.worker = undefined;
    slot.messageListener = undefined;
    slot.errorListener = undefined;
    slot.activeRequestId = undefined;

    if (terminateWorker) {
      worker.terminate();
    }

    if (!this.destroyed) {
      this.ensureWorker(slotIndex);
    }
  }

  private flushQueue(): void {
    while (this.queuedRequests.length > 0) {
      const slotIndex = this.getIdleSlotIndex();
      if (slotIndex === undefined) {
        return;
      }

      const request = this.queuedRequests.shift();
      if (!request) {
        return;
      }

      if (request.state !== 'queued') {
        continue;
      }

      this.startRequest(slotIndex, request);
    }
  }

  private getIdleSlotIndex(): number | undefined {
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index];
      if (slot.activeRequestId !== undefined) {
        continue;
      }

      if (!slot.worker && !this.ensureWorker(index)) {
        continue;
      }

      if (slot.worker) {
        return index;
      }
    }

    return undefined;
  }

  private handleWorkerMessage(slotIndex: number, event: unknown): void {
    let extracted: { id: number; result: TResult } | null;

    try {
      extracted = this.options.extractResult(event);
    }
    catch (error) {
      this.rejectActiveRequest(slotIndex, error instanceof Error ? error : new Error(`${this.options.dispatcherName} worker failed.`));
      return;
    }

    if (!extracted) {
      return;
    }

    const request = this.getActiveRequest(slotIndex);
    if (!request || request.id !== extracted.id) {
      return;
    }

    this.resolveActiveRequest(slotIndex, request, extracted.result);
  }

  private handleWorkerError(slotIndex: number, event: unknown): void {
    const request = this.getActiveRequest(slotIndex);
    if (request) {
      this.rejectActiveRequest(slotIndex, event instanceof Error
        ? event
        : new Error(`${this.options.dispatcherName} worker failed.`));
      return;
    }

    this.releaseWorker(slotIndex, false);
    this.flushQueue();
  }

  private startRequest(slotIndex: number, request: WorkerPoolRequest<TJob, TResult>): void {
    const slot = this.slots[slotIndex];
    if (!slot?.worker) {
      return;
    }

    if (request.signal?.aborted) {
      this.settleRequest(request, createAbortError(), false);
      return;
    }

    slot.activeRequestId = request.id;
    request.state = 'active';
    request.slotIndex = slotIndex;

    try {
      const { message, transfer } = this.options.createJobMessage(request.id, request.job);
      slot.worker.postMessage(message, transfer);
    }
    catch (error) {
      this.releaseWorker(slotIndex, true);
      this.settleRequest(request, error instanceof Error
        ? error
        : new Error(`${this.options.dispatcherName} worker failed.`), false);
      this.flushQueue();
    }
  }

  private resolveActiveRequest(
    slotIndex: number,
    request: WorkerPoolRequest<TJob, TResult>,
    result: TResult,
  ): void {
    this.clearActiveRequest(slotIndex, request.id);
    this.settleRequest(request, result, true);
    this.flushQueue();
  }

  private rejectActiveRequest(
    slotIndex: number,
    error: Error,
  ): void {
    const request = this.getActiveRequest(slotIndex);
    if (!request) {
      this.releaseWorker(slotIndex, false);
      return;
    }

    this.releaseWorker(slotIndex, false);
    this.settleRequest(request, error, false);
    this.flushQueue();
  }

  private clearActiveRequest(slotIndex: number, requestId: number): void {
    const slot = this.slots[slotIndex];
    if (!slot || slot.activeRequestId !== requestId) {
      return;
    }

    slot.activeRequestId = undefined;
  }

  private getActiveRequest(slotIndex: number): WorkerPoolRequest<TJob, TResult> | undefined {
    const slot = this.slots[slotIndex];
    const requestId = slot?.activeRequestId;
    if (requestId === undefined) {
      return undefined;
    }

    return this.requestRecords.get(requestId);
  }

  private removeQueuedRequest(requestId: number): WorkerPoolRequest<TJob, TResult> | undefined {
    const index = this.queuedRequests.findIndex(request => request.id === requestId);
    if (index < 0) {
      return undefined;
    }

    const [request] = this.queuedRequests.splice(index, 1);
    return request;
  }

  private settleRequest(
    request: WorkerPoolRequest<TJob, TResult>,
    value: TResult | Error,
    shouldResolve: boolean,
  ): void {
    const currentRequest = this.requestRecords.get(request.id);
    if (currentRequest !== request) {
      return;
    }

    this.requestRecords.delete(request.id);
    request.cleanupAbortListener?.();
    request.cleanupAbortListener = undefined;
    request.slotIndex = undefined;
    request.state = 'queued';

    if (shouldResolve) {
      request.resolve(value as TResult);
      return;
    }

    request.reject(value);
  }
}
