/// <reference lib="webworker" />

import type { BucketTileWorkerMessage, BucketTileWorkerResponse } from './bucket-tile-dispatcher';
import { compileBucketTileFromData } from './bucket-tile-compiler';

declare const self: DedicatedWorkerGlobalScope;

const cancelledRequestIds = new Set<number>();
const scheduledJobs = new Map<number, number>();

self.addEventListener('message', (event: MessageEvent<BucketTileWorkerMessage>) => {
  if (event.data.type === 'cancel-bucket-tile') {
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
      const bucketTile = compileBucketTileFromData({
        renderTile: compileMessage.renderTile,
        tileData: compileMessage.tileData,
        tileProjection: compileMessage.tileProjection,
      });
      if (cancelledRequestIds.has(compileMessage.id)) {
        cancelledRequestIds.delete(compileMessage.id);
        return;
      }

      const transferables = extractTransferables(bucketTile);
      const response: BucketTileWorkerResponse = {
        bucketTile,
        id: compileMessage.id,
        type: 'bucket-tile-result',
      };
      self.postMessage(response, transferables);
    }
    catch (error) {
      if (cancelledRequestIds.has(compileMessage.id)) {
        cancelledRequestIds.delete(compileMessage.id);
        return;
      }

      const response: BucketTileWorkerResponse = {
        error: error instanceof Error ? error.message : `${error}`,
        id: compileMessage.id,
        type: 'bucket-tile-error',
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

function extractTransferables(bucketTile: any): Transferable[] {
  const transferables: Transferable[] = [];

  for (const bucket of bucketTile.buckets) {
    if (bucket.data.positions) {
      transferables.push(bucket.data.positions.buffer);
    }
    if (bucket.data.triangles) {
      transferables.push(bucket.data.triangles.buffer);
    }
    if (bucket.data.featureIds) {
      transferables.push(bucket.data.featureIds.buffer);
    }
    if (bucket.data.vertexCounts) {
      transferables.push(bucket.data.vertexCounts.buffer);
    }
  }

  return transferables;
}

export {};
