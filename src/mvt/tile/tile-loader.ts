import type { TileCoordinate } from '../types';
import { Resource } from '@cesium/engine';

export interface TileLoadResult {
  arrayBuffer: ArrayBuffer;
  byteLength: number;
  url: string;
}

export interface TileLoader {
  loadTile: (coordinate: TileCoordinate, signal?: AbortSignal) => Promise<TileLoadResult>;
}

export interface DefaultTileLoaderOptions {
  fetch?: typeof fetch;
  tileTemplate: string;
}

export class DefaultTileLoader implements TileLoader {
  private readonly fetcher?: typeof fetch;
  private readonly tileTemplate: string;

  constructor(options: DefaultTileLoaderOptions) {
    if (!options.tileTemplate) {
      throw new Error('Tile template is required.');
    }

    this.tileTemplate = options.tileTemplate;
    this.fetcher = options.fetch;
  }

  buildTileUrl(coordinate: TileCoordinate): string {
    const dimension = 1 << coordinate.z;
    const reverseX = dimension - coordinate.x - 1;
    const reverseY = dimension - coordinate.y - 1;

    return this.tileTemplate
      .replaceAll('{z}', String(coordinate.z))
      .replaceAll('{x}', String(coordinate.x))
      .replaceAll('{y}', String(coordinate.y))
      .replaceAll('{reverseX}', String(reverseX))
      .replaceAll('{reverseY}', String(reverseY));
  }

  async loadTile(coordinate: TileCoordinate, signal?: AbortSignal): Promise<TileLoadResult> {
    const url = this.buildTileUrl(coordinate);
    const arrayBuffer = this.fetcher
      ? await fetchTileArrayBuffer(url, this.fetcher, signal)
      : await loadTileArrayBufferWithResource(url, signal);

    return {
      arrayBuffer,
      byteLength: arrayBuffer.byteLength,
      url,
    };
  }
}

async function fetchTileArrayBuffer(
  url: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetcher(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch tile: ${response.status} ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

async function loadTileArrayBufferWithResource(
  url: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  const resource = new Resource({ url });
  const promise = resource.fetchArrayBuffer();
  if (!promise) {
    throw new Error(`Failed to schedule tile request for "${url}".`);
  }

  const arrayBuffer = await promise;
  if (signal?.aborted) {
    throw createAbortError();
  }

  return arrayBuffer;
}

function createAbortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}
