/// <reference lib="webworker" />

import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-types';
import { parseVectorTile } from '../parse/vector-tile-parser';
import { StyleSet } from '../style/style-set';

let cachedStyleKey: string | undefined;
let cachedStyleSet: StyleSet | undefined;

globalThis.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  const request = event.data;

  try {
    const styleSet = getWorkerStyleSet(request);
    const parsedTileData = parseVectorTile(request.arrayBuffer, styleSet, request.zoom);
    const response: ParseWorkerResponse = {
      id: request.id,
      parsedTileData,
    };
    globalThis.postMessage(response);
  }
  catch (error) {
    const response: ParseWorkerResponse = {
      error: error instanceof Error ? error.message : String(error),
      id: request.id,
    };
    globalThis.postMessage(response);
  }
};

function getWorkerStyleSet(request: ParseWorkerRequest): StyleSet {
  const styleKey = `${request.sourceId ?? ''}::${JSON.stringify(request.styleSpecification)}`;
  if (cachedStyleSet && cachedStyleKey === styleKey) {
    return cachedStyleSet;
  }

  cachedStyleKey = styleKey;
  cachedStyleSet = StyleSet.fromSpecification(request.styleSpecification, {
    source: request.sourceId,
  });
  return cachedStyleSet;
}

export {};
