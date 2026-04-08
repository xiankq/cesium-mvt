import { describe, expect, it } from 'vitest';
import { parseMvtVectorTile } from '../src/mvt/parse/mvt-vector-tile-parser';
import { MvtParseWorkerClient } from '../src/mvt/worker/mvt-parse-worker-client';
import { createTestLocalMvtArrayBuffer, createTestMvtArrayBuffer } from './mvt-test-tile';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

describe('mvt-parse-worker-client', () => {
  it('falls back to synchronous parsing when worker is unavailable', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestMvtArrayBuffer({
      building: {
        features: [
          {
            geometry: {
              coordinates: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]],
              type: 'Polygon',
            },
            properties: {
              name: 'Worker Fallback Building',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    const workerClient = new MvtParseWorkerClient();
    const workerParsedTile = await workerClient.parseTile(tileBuffer, styleSet, 14);
    const syncParsedTile = parseMvtVectorTile(tileBuffer, styleSet, 14);

    expect(workerParsedTile).toEqual(syncParsedTile);
    workerClient.destroy();
  }, 15000);

  it('falls back to synchronous parsing when worker responds with an error', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestLocalMvtArrayBuffer({
      building: {
        features: [{
          geometry: {
            coordinates: [[[256, 256], [256, 1024], [1024, 1024], [1024, 256], [256, 256]]],
            type: 'Polygon',
          },
          properties: {
            name: 'Worker Error Fallback Building',
          },
        }],
      },
    });
    const syncParsedTile = parseMvtVectorTile(tileBuffer, styleSet, 14);

    const originalWindow = (globalThis as typeof globalThis & { window?: object }).window;
    const originalWorker = globalThis.Worker;

    class MockWorker {
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessage: ((event: MessageEvent<{ error?: string; id: number }>) => void) | null = null;

      postMessage(request: { id: number }): void {
        this.onmessage?.({
          data: {
            error: 'mock worker parse failure',
            id: request.id,
          },
        } as MessageEvent<{ error?: string; id: number }>);
      }

      terminate(): void {}
    }

    (globalThis as typeof globalThis & { window?: object }).window = {};
    globalThis.Worker = MockWorker as unknown as typeof Worker;

    try {
      const workerClient = new MvtParseWorkerClient();
      const workerParsedTile = await workerClient.parseTile(tileBuffer, styleSet, 14);
      expect(workerParsedTile).toEqual(syncParsedTile);
      workerClient.destroy();
    }
    finally {
      if (originalWindow === undefined) {
        delete (globalThis as typeof globalThis & { window?: object }).window;
      }
      else {
        (globalThis as typeof globalThis & { window?: object }).window = originalWindow;
      }
      globalThis.Worker = originalWorker;
    }
  }, 15000);
});
