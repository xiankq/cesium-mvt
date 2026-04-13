/// <reference lib="webworker" />

import type { FeatureTileWorkerMessage, FeatureTileWorkerResponse } from '../render/feature-tile-dispatcher';
import { compileFeatureTile } from '../render/feature-tile';
import { parseVectorTile } from '../source/vector-tile';
import { formatErrorMessage } from '../utils/common';

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', (event: MessageEvent<FeatureTileWorkerMessage>) => {
  const compileMessage = event.data;
  self.setTimeout(() => {
    try {
      const featureTile = compileFeatureTile({
        renderTile: compileMessage.renderTile,
        tile: parseVectorTile(compileMessage.tileData),
      });

      const response: FeatureTileWorkerResponse = {
        featureTile,
        id: compileMessage.id,
        type: 'feature-tile-result',
      };
      self.postMessage(response);
    }
    catch (error) {
      const response: FeatureTileWorkerResponse = {
        error: formatErrorMessage(error, 'Feature tile worker failed.'),
        id: compileMessage.id,
        type: 'feature-tile-error',
      };
      self.postMessage(response);
    }
  }, 0);
});

export {};
