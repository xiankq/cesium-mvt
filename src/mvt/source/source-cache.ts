import type {
  SourceSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { TileCoordinate, TileRequest } from './tile-request';
import { createAbortError, isAbortError, resolveUrl } from '../utils/common';
import {
  createTileKey,
  createTileRequest,
} from './tile-request';

// SourceCache 负责单个 sourceId 的请求去重与 source 级失效管理。
export interface TileJson {
  maxzoom?: number;
  minzoom?: number;
  scheme?: 'tms' | 'xyz';
  tiles?: string[];
}

export interface SourceEntry<TValue> {
  error?: unknown;
  key: string;
  state: SourceEntryState;
  value?: TValue;
}

export type SourceEntryState = 'failed' | 'idle' | 'ready' | 'requesting';

interface SourceEntryRecord<TValue> extends SourceEntry<TValue> {
  abortController?: AbortController;
  promise?: Promise<TValue>;
}

interface SourceCacheOptions<TValue> {
  loadTile?: (request: TileRequest, signal: AbortSignal) => Promise<TValue>;
  loadTileJson?: (url: string, signal: AbortSignal) => Promise<TileJson>;
  source: SourceSpecification;
  sourceId: string;
}

const DEFAULT_SOURCE_ENTRY_STATE: SourceEntryState = 'idle';

export class SourceCache<TValue = ArrayBuffer> {
  readonly sourceType: SourceSpecification['type'];

  private destroyed = false;
  private readonly entries = new Map<string, SourceEntryRecord<TValue>>();
  private readonly loadTile: (
    request: TileRequest,
    signal: AbortSignal,
  ) => Promise<TValue>;

  private readonly loadTileJson: (
    url: string,
    signal: AbortSignal,
  ) => Promise<TileJson>;

  private source: SourceSpecification;
  private sourceSignature: string;
  private readonly sourceId: string;
  private tileJsonAbortController?: AbortController;
  private tileJsonPromise?: Promise<TileJson>;
  private cachedTileJson?: TileJson;

  constructor(options: SourceCacheOptions<TValue>) {
    this.loadTile
      = options.loadTile
        ?? (loadTileBuffer as (
          request: TileRequest,
          signal: AbortSignal,
        ) => Promise<TValue>);
    this.loadTileJson = options.loadTileJson ?? loadTileJson;
    this.source = options.source;
    this.sourceType = options.source.type;
    this.sourceId = options.sourceId;
    this.sourceSignature = JSON.stringify(options.source);
  }

  async requestTile(coordinate: TileCoordinate) {
    const key = createTileKey(
      this.sourceId,
      coordinate.level,
      coordinate.x,
      coordinate.y,
    );
    const existingEntry = this.entries.get(key);
    if (existingEntry?.state === 'ready' && existingEntry.value !== undefined) {
      if (existingEntry.value instanceof ArrayBuffer && isBufferDetached(existingEntry.value)) {
        this.entries.delete(key);
      }
      else if (existingEntry.value instanceof ArrayBuffer) {
        return existingEntry.value.slice(0);
      }
      else {
        return existingEntry.value;
      }
    }
    if (existingEntry?.promise) {
      return existingEntry.promise.then((value) => {
        if (value instanceof ArrayBuffer) {
          return value.slice(0);
        }
        return value;
      });
    }

    const entry = existingEntry ?? this.createEntry(key);
    const abortController = new AbortController();
    entry.abortController = abortController;
    entry.error = undefined;
    entry.state = 'requesting';
    entry.promise = this.resolveTileRequest(coordinate)
      .then(request => this.loadTile(request, abortController.signal))
      .then((value) => {
        if (abortController.signal.aborted) {
          throw createAbortError();
        }

        entry.abortController = undefined;
        entry.promise = undefined;
        entry.state = 'ready';
        entry.value = value;
        return value;
      })
      .catch((error) => {
        entry.abortController = undefined;
        entry.promise = undefined;
        if (abortController.signal.aborted || isAbortError(error)) {
          entry.error = undefined;
          entry.state = 'idle';
          throw error;
        }

        entry.error = error;
        entry.state = 'failed';
        throw error;
      });

    return entry.promise;
  }

  abortTile(key: string) {
    this.entries.get(key)?.abortController?.abort();
  }

  getEntry(key: string): SourceEntry<TValue> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    return {
      error: entry.error,
      key: entry.key,
      state: entry.state,
      value: entry.value,
    };
  }

  updateSource(source: SourceSpecification) {
    const nextSignature = JSON.stringify(source);
    if (nextSignature === this.sourceSignature) {
      return;
    }

    this.source = source;
    this.sourceSignature = nextSignature;
    this.reset();
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.reset();
    this.destroyed = true;
  }

  private createEntry(key: string) {
    const entry: SourceEntryRecord<TValue> = {
      key,
      state: DEFAULT_SOURCE_ENTRY_STATE,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private reset() {
    this.tileJsonAbortController?.abort();
    this.tileJsonAbortController = undefined;
    this.tileJsonPromise = undefined;
    for (const entry of this.entries.values()) {
      entry.abortController?.abort();
    }
    this.entries.clear();
  }

  private async resolveTileRequest(coordinate: TileCoordinate) {
    const tileJson = await this.getTileJson();
    return createTileRequest({
      coordinate,
      scheme: tileJson.scheme ?? getSourceScheme(this.source),
      sourceId: this.sourceId,
      tiles: tileJson.tiles ?? [],
    });
  }

  private async getTileJson(): Promise<TileJson> {
    if (hasInlineTiles(this.source)) {
      const inlineTileJson: TileJson = {
        scheme: getSourceScheme(this.source),
        tiles: this.source.tiles,
      };
      this.cachedTileJson = inlineTileJson;
      return inlineTileJson;
    }

    const tileJsonUrl = getTileJsonUrl(this.source);
    if (!tileJsonUrl) {
      throw new Error(`Unsupported source for tile requests: ${this.sourceId}`);
    }

    if (this.tileJsonPromise) {
      return this.tileJsonPromise;
    }

    // TileJSON 按 source 签名缓存，避免重复请求瓦片时反复拉取元数据。
    const abortController = new AbortController();
    this.tileJsonAbortController = abortController;
    this.tileJsonPromise = this.loadTileJson(
      tileJsonUrl,
      abortController.signal,
    ).then((tileJson) => {
      if (abortController.signal.aborted) {
        throw createAbortError();
      }

      const normalized = normalizeTileJson(
        tileJson,
        tileJsonUrl,
        getSourceScheme(this.source),
      );
      this.cachedTileJson = normalized;
      return normalized;
    }).catch((error) => {
      this.tileJsonAbortController = undefined;
      this.tileJsonPromise = undefined;
      throw error;
    });

    return this.tileJsonPromise;
  }

  getMaxZoom(): number | undefined {
    return this.cachedTileJson?.maxzoom;
  }

  getMinZoom(): number | undefined {
    return this.cachedTileJson?.minzoom;
  }
}

function hasInlineTiles(source: SourceSpecification): source is VectorSourceSpecification {
  return 'tiles' in source
    && Array.isArray(source.tiles)
    && source.tiles.length > 0;
}

function getTileJsonUrl(source: SourceSpecification) {
  return 'url' in source && typeof source.url === 'string'
    ? source.url
    : undefined;
}

function getSourceScheme(source: SourceSpecification) {
  return 'scheme' in source && source.scheme === 'tms'
    ? 'tms'
    : 'xyz';
}

function normalizeTileJson(
  tileJson: TileJson,
  tileJsonUrl: string,
  fallbackScheme: 'tms' | 'xyz',
): TileJson {
  return {
    maxzoom: tileJson.maxzoom,
    minzoom: tileJson.minzoom,
    scheme: tileJson.scheme ?? fallbackScheme,
    tiles: tileJson.tiles?.map(tileUrl => resolveUrl(tileUrl, tileJsonUrl)),
  };
}

async function loadTileJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load tilejson: ${url}`);
  }

  return await response.json() as TileJson;
}

async function loadTileBuffer(
  request: TileRequest,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(request.url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load tile: ${request.url}`);
  }

  return await response.arrayBuffer();
}

function isBufferDetached(buffer: ArrayBuffer): boolean {
  return buffer.byteLength === 0;
}
