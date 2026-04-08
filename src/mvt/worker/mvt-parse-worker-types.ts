import type { MvtParsedTileData, MvtStyleSpecification } from '../mvt-types';

export interface MvtParseWorkerRequest {
  arrayBuffer: ArrayBuffer;
  id: number;
  sourceId?: string;
  styleSpecification: MvtStyleSpecification;
  zoom: number;
}

export interface MvtParseWorkerResponse {
  error?: string;
  id: number;
  parsedTileData?: MvtParsedTileData;
}
