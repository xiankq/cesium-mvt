import type { DecodedTileRecord, TileDecodeJob } from '../types';

export interface WorkerDecodeRequest {
  id: number;
  kind: 'decode';
  job: TileDecodeJob;
}

export interface WorkerCancelRequest {
  id: number;
  kind: 'cancel';
}

export type WorkerRequest = WorkerDecodeRequest | WorkerCancelRequest;

export interface WorkerSuccessResponse {
  id: number;
  ok: true;
  tile: DecodedTileRecord;
}

export interface WorkerErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export type WorkerScope = typeof globalThis & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerSuccessResponse | WorkerErrorResponse) => void;
};

export function createTileDecodeAbortError(tileId: string): Error {
  const error = new Error(`Tile decode aborted for ${tileId}.`);
  error.name = 'AbortError';
  return error;
}

export function isTileDecodeAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
