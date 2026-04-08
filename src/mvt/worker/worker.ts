import type {  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
  TileDecodeJob,
  TileGeometryType,
} from '../types';
import type { WorkerErrorResponse, WorkerRequest, WorkerScope, WorkerSuccessResponse } from './protocol';
import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { isTileDecodeAbortError,

} from './protocol';

interface ActiveRequest {
  tileId: string;
  controller: AbortController;
}

const workerScope = globalThis as WorkerScope;
const activeRequests = new Map<number, ActiveRequest>();

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.kind === 'cancel') {
    const activeRequest = activeRequests.get(message.id);
    if (!activeRequest) {
      return;
    }

    activeRequests.delete(message.id);
    activeRequest.controller.abort();
    return;
  }

  const controller = new AbortController();
  activeRequests.set(message.id, {
    tileId: message.job.id,
    controller,
  });

  try {
    const tile = await decodeTile(message.job, controller.signal);
    if (!activeRequests.has(message.id)) {
      return;
    }

    const response: WorkerSuccessResponse = {
      id: message.id,
      ok: true,
      tile,
    };
    workerScope.postMessage(response);
  }
  catch (error) {
    if (!activeRequests.has(message.id) || isTileDecodeAbortError(error)) {
      return;
    }

    const response: WorkerErrorResponse = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
  finally {
    activeRequests.delete(message.id);
  }
};

async function decodeTile(
  job: TileDecodeJob,
  signal: AbortSignal,
): Promise<DecodedTileRecord> {
  const fetchedAt = Date.now();
  const response = await fetch(job.url, {
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `[fetch] Failed to fetch tile ${job.id} from ${job.url}: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = await response.arrayBuffer();
  let vectorTile: VectorTile;
  try {
    vectorTile = new VectorTile(new Pbf(buffer));
  }
  catch (error) {
    throw new Error(
      `[parse] Failed to parse tile ${job.id} from ${job.url}: ${toErrorMessage(error)}`,
    );
  }

  let layers: DecodedLayerRecord[];
  try {
    layers = Object.entries(vectorTile.layers).map(([name, layer]) =>
      decodeLayer(job, name, layer),
    );
  }
  catch (error) {
    throw new Error(
      `[decode] Failed to decode tile ${job.id} from ${job.url}: ${toErrorMessage(error)}`,
    );
  }

  return {
    id: job.id,
    sourceId: job.sourceId,
    coord: job.coord,
    url: job.url,
    fetchedBytes: buffer.byteLength,
    requestedAt: job.requestedAt,
    fetchedAt,
    decodedAt: Date.now(),
    layers,
  };
}

function decodeLayer(
  job: TileDecodeJob,
  name: string,
  layer: VectorTile['layers'][string],
): DecodedLayerRecord {
  const features: DecodedFeatureRecord[] = [];
  const geometryHistogram: Record<TileGeometryType, number> = {
    Unknown: 0,
    Point: 0,
    LineString: 0,
    Polygon: 0,
  };

  for (let index = 0; index < layer.length; index += 1) {
    try {
      const feature = layer.feature(index);
      const type = VectorTileFeature.types[feature.type] ?? 'Unknown';
      const geometry = feature.loadGeometry().map(part =>
        part.map(point => [point.x, point.y] as [number, number]),
      );

      geometryHistogram[type] += 1;

      features.push({
        id: feature.id,
        type,
        bbox: feature.bbox() as [number, number, number, number],
        properties: feature.properties,
        geometry,
      });
    }
    catch (error) {
      throw new Error(
        `[layer:${name}] Failed to decode feature ${index} for tile ${job.id}: ${toErrorMessage(error)}`,
      );
    }
  }

  return {
    name,
    extent: layer.extent,
    featureCount: layer.length,
    geometryHistogram,
    features,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
