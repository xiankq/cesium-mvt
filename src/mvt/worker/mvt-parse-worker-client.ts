import type { MvtParsedTileData } from '../mvt-types';
import type { MvtStyleSet } from '../style/mvt-style-set';
import type { MvtParseWorkerRequest, MvtParseWorkerResponse } from './mvt-parse-worker-types';
import { isMvtDebugLoggingEnabled, logMvtWarning } from '../mvt-log';
import { parseMvtVectorTile } from '../parse/mvt-vector-tile-parser';

interface MvtPendingParse {
  reject: (reason?: unknown) => void;
  resolve: (parsedTileData: MvtParsedTileData) => void;
}

export interface MvtParseWorkerClientOptions {
  debugLogging?: boolean;
}

export class MvtParseWorkerClient {
  private readonly debugLogging: boolean;
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<number, MvtPendingParse>();
  private worker?: Worker;

  constructor(options: MvtParseWorkerClientOptions = {}) {
    this.debugLogging = isMvtDebugLoggingEnabled(options.debugLogging);
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
    styleSet: MvtStyleSet,
    zoom: number,
  ): Promise<MvtParsedTileData> {
    if (!canUseParseWorker()) {
      return Promise.resolve(parseMvtVectorTile(arrayBuffer, styleSet, zoom));
    }

    const worker = this.getOrCreateWorker();
    const requestId = this.nextRequestId++;
    const request: MvtParseWorkerRequest = {
      arrayBuffer,
      id: requestId,
      sourceId: styleSet.sourceId,
      styleSpecification: styleSet.specification,
      zoom,
    };

    return new Promise<MvtParsedTileData>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        reject,
        resolve,
      });
      worker.postMessage(request);
    }).catch((error) => {
      logMvtWarning(this.debugLogging, 'MVT parse worker 失败，回退到主线程同步解析。', {
        error,
        zoom,
      });
      return parseMvtVectorTile(arrayBuffer, styleSet, zoom);
    });
  }

  private getOrCreateWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(
      new URL('./mvt-parse-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<MvtParseWorkerResponse>) => {
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
