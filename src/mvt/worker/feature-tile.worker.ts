/// <reference lib="webworker" />

import type { FeatureTileWorkerMessage, FeatureTileWorkerResponse } from './feature-tile-dispatcher';
import { compileFeatureTile } from '../render/feature-tile';
import { parseVectorTile } from '../source/vector-tile';

declare const self: DedicatedWorkerGlobalScope;

const cancelledRequestIds = new Set<number>();
const scheduledJobs = new Map<number, number>();

self.addEventListener('message', (event: MessageEvent<FeatureTileWorkerMessage>) => {
  if (event.data.type === 'cancel-feature-tile') {
    cancelledRequestIds.add(event.data.id);
    const scheduledJob = scheduledJobs.get(event.data.id);
    if (scheduledJob !== undefined) {
      clearTimeout(scheduledJob);
      scheduledJobs.delete(event.data.id);
    }
    return;
  }

  const compileMessage = event.data;
  const timer = self.setTimeout(() => {
    scheduledJobs.delete(compileMessage.id);
    if (cancelledRequestIds.has(compileMessage.id)) {
      cancelledRequestIds.delete(compileMessage.id);
      return;
    }

    try {
      const featureTile = compileFeatureTile({
        renderTile: compileMessage.renderTile,
        tile: parseVectorTile(compileMessage.tileData),
      });
      if (cancelledRequestIds.has(compileMessage.id)) {
        cancelledRequestIds.delete(compileMessage.id);
        return;
      }

      const response: FeatureTileWorkerResponse = {
        featureTile,
        id: compileMessage.id,
        type: 'feature-tile-result',
      };
      self.postMessage(response);
    }
    catch (error) {
      if (cancelledRequestIds.has(compileMessage.id)) {
        cancelledRequestIds.delete(compileMessage.id);
        return;
      }

      const response: FeatureTileWorkerResponse = {
        error: error instanceof Error ? error.message : `${error}`,
        id: compileMessage.id,
        type: 'feature-tile-error',
      };
      self.postMessage(response);
    }
  }, 0);
  scheduledJobs.set(compileMessage.id, timer);
});

self.addEventListener('close', () => {
  for (const timer of scheduledJobs.values()) {
    clearTimeout(timer);
  }
  scheduledJobs.clear();
  cancelledRequestIds.clear();
});

export {};
