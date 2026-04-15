/// <reference lib="webworker" />

import type { BucketTileWorkerMessage, BucketTileWorkerResponse } from '../bucket/bucket-tile-dispatcher';
import { compileBucketTileFromData } from '../bucket/bucket-tile-compiler';
import { formatErrorMessage } from '../utils/common';

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', (event: MessageEvent<BucketTileWorkerMessage>) => {
  const compileMessage = event.data;
  self.setTimeout(() => {
    try {
      const bucketTile = compileBucketTileFromData({
        renderTile: compileMessage.renderTile,
        style: compileMessage.style,
        styleIndex: compileMessage.styleIndex,
        tileData: compileMessage.tileData,
        tileProjection: compileMessage.tileProjection,
      });

      const transferables = extractTransferables(bucketTile);
      const response: BucketTileWorkerResponse = {
        bucketTile,
        id: compileMessage.id,
        type: 'bucket-tile-result',
      };
      self.postMessage(response, transferables);
    }
    catch (error) {
      const response: BucketTileWorkerResponse = {
        error: formatErrorMessage(error, 'Bucket tile worker failed.'),
        id: compileMessage.id,
        type: 'bucket-tile-error',
      };
      self.postMessage(response);
    }
  }, 0);
});

function extractTransferables(bucketTile: any): Transferable[] {
  const transferables: Transferable[] = [];

  if (!bucketTile?.buckets) {
    return transferables;
  }

  for (const bucket of bucketTile.buckets) {
    if (!bucket?.data) {
      continue;
    }
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
