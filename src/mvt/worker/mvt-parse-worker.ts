/// <reference lib="webworker" />

import type { MvtParseWorkerRequest, MvtParseWorkerResponse } from './mvt-parse-worker-types';
import { parseMvtVectorTile } from '../parse/mvt-vector-tile-parser';
import { MvtStyleSet } from '../style/mvt-style-set';

let cachedStyleKey: string | undefined;
let cachedStyleSet: MvtStyleSet | undefined;

globalThis.onmessage = (event: MessageEvent<MvtParseWorkerRequest>) => {
  const request = event.data;

  try {
    const styleSet = getWorkerStyleSet(request);
    const parsedTileData = parseMvtVectorTile(request.arrayBuffer, styleSet, request.zoom);
    const response: MvtParseWorkerResponse = {
      id: request.id,
      parsedTileData,
    };
    globalThis.postMessage(response);
  }
  catch (error) {
    const response: MvtParseWorkerResponse = {
      error: error instanceof Error ? error.message : String(error),
      id: request.id,
    };
    globalThis.postMessage(response);
  }
};

function getWorkerStyleSet(request: MvtParseWorkerRequest): MvtStyleSet {
  const styleKey = `${request.sourceId ?? ''}::${JSON.stringify(request.styleSpecification)}`;
  if (cachedStyleSet && cachedStyleKey === styleKey) {
    return cachedStyleSet;
  }

  cachedStyleKey = styleKey;
  cachedStyleSet = MvtStyleSet.fromSpecification(request.styleSpecification, {
    source: request.sourceId,
  });
  return cachedStyleSet;
}

export {};
