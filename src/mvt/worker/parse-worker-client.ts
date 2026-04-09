import type { StyleSet } from '../style/style-set';
import type { ParsedTileData } from '../types';
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-types';
import { isDebugLoggingEnabled, logWarning } from '../log';
import { parseVectorTile } from '../parse/vector-tile-parser';

interface PendingParse {
  reject: (reason?: unknown) => void;
  resolve: (parsedTileData: ParsedTileData) => void;
}

export interface ParseWorkerClientOptions {
  debugLogging?: boolean;
}

export class ParseWorkerClient {
  private readonly debugLogging: boolean;
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<number, PendingParse>();
  private worker?: Worker;

  constructor(options: ParseWorkerClientOptions = {}) {
    this.debugLogging = isDebugLoggingEnabled(options.debugLogging);
  }

  destroy(): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.reject(new Error('MVT parse worker was destroyed.'));
    }
    this.pendingRequests.clear();
    this.worker?.terminate();
    this.worker = undefined;
  }

  isWorkerEnabled(): boolean {
    return canUseParseWorker();
  }

  parseTile(
    arrayBuffer: ArrayBuffer,
    styleSet: StyleSet,
    zoom: number,
  ): Promise<ParsedTileData> {
    if (!canUseParseWorker()) {
      return Promise.resolve(parseVectorTile(arrayBuffer, styleSet, zoom));
    }

    const worker = this.getOrCreateWorker();
    const requestId = this.nextRequestId++;
    const request: ParseWorkerRequest = {
      arrayBuffer,
      id: requestId,
      sourceId: styleSet.sourceId,
      styleSpecification: styleSet.specification,
      zoom,
    };

    return new Promise<ParsedTileData>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        reject,
        resolve,
      });
      worker.postMessage(request);
    }).catch((error) => {
      logWarning(this.debugLogging, 'MVT parse worker 失败，回退到主线程同步解析。', {
        error,
        zoom,
      });
      return parseVectorTile(arrayBuffer, styleSet, zoom);
    });
  }

  private getOrCreateWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(
      new URL('./parse-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const response = event.data;
      const pendingRequest = this.pendingRequests.get(response.id);
      if (!pendingRequest) {
        return;
      }

      this.pendingRequests.delete(response.id);
      if (response.error) {
        pendingRequest.reject(new Error(response.error));
        return;
      }
      if (!response.parsedTileData) {
        pendingRequest.reject(new Error('MVT parse worker returned no parsed tile data.'));
        return;
      }

      pendingRequest.resolve(response.parsedTileData);
    };
    worker.onerror = (event) => {
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Unknown MVT parse worker error.');
      for (const pendingRequest of this.pendingRequests.values()) {
        pendingRequest.reject(error);
      }
      this.pendingRequests.clear();
      worker.terminate();
      if (this.worker === worker) {
        this.worker = undefined;
      }
    };

    this.worker = worker;
    return worker;
  }
}

function canUseParseWorker(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}
