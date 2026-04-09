import type { TilingScheme } from 'cesium';
import type { RenderTile } from '../render/render-tile';
import type { ParsedTileResult } from './bucket/bucket-types';

export interface CompileBucketTileJob {
  renderTile: RenderTile;
  signal?: AbortSignal;
  tileData: ArrayBuffer;
  tilingScheme: TilingScheme;
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
  tilingScheme: TilingScheme;
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
