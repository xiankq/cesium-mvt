import type { ParsedTileData, StyleSpecification } from '../types';

export interface ParseWorkerRequest {
  arrayBuffer: ArrayBuffer;
  id: number;
  sourceId?: string;
  styleSpecification: StyleSpecification;
  zoom: number;
}

export interface ParseWorkerResponse {
  error?: string;
  id: number;
  parsedTileData?: ParsedTileData;
}
