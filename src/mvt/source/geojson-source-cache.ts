import type {
  GeoJSONSourceSpecification,
  SourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { GeoJsonObject } from 'geojson';
import type { RequestPriority, RequestPriorityState } from './request-scheduler';
import type { TileCoordinate } from './tile-request';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { createAbortError, deepClone, isAbortError } from '../utils/common';
import { TileBudget } from '../utils/tile-budget';
import {
  createThrottleError,
  isThrottleError,

  scheduleJsonRequest,
} from './request-scheduler';
import { createTileKey } from './tile-request';

// GeoJSON source 会先转成内存中的“向量瓦片形态”，这样下游渲染链路可以保持单轨实现。
export const GEOJSON_SOURCE_LAYER = '_geojson';

type SourceEntryState = 'failed' | 'idle' | 'ready' | 'requesting';

const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

interface SourceEntryRecord {
  abortController?: AbortController;
  error?: unknown;
  failureCount: number;
  key: string;
  priorityState?: RequestPriorityState;
  promise?: Promise<ArrayBuffer | undefined>;
  state: SourceEntryState;
  value?: ArrayBuffer;
  nextRetryAt?: number;
}

interface GeojsonSourceCacheOptions {
  loadData?: (
    source: GeoJSONSourceSpecification,
    signal: AbortSignal,
    priority?: RequestPriority,
  ) => Promise<GeoJsonObject>;
  maxBytes?: number;
  maximumCacheOverflowBytes?: number;
  readyTileBudget?: TileBudget;
  source: SourceSpecification;
  sourceId: string;
}

const EMPTY_TILE_DATA = new ArrayBuffer(0);
const DEFAULT_SOURCE_CACHE_SIZE = 64 * 1024 * 1024;
type GeojsonTileIndexInput = ConstructorParameters<typeof GeoJSONVT>[0];
type GeojsonTileIndexOptions = ConstructorParameters<typeof GeoJSONVT>[1];
type GeojsonVtLayers = Parameters<typeof fromGeojsonVt>[0];

export class GeojsonSourceCache {
  readonly sourceType = 'geojson';

  private destroyed = false;
  private readonly entries = new Map<string, SourceEntryRecord>();
  private readonly readyTileBudget: TileBudget;
  private readonly loadData: (
    source: GeoJSONSourceSpecification,
    signal: AbortSignal,
    priority?: RequestPriority,
  ) => Promise<GeoJsonObject>;

  private source: GeoJSONSourceSpecification;
  private sourceSignature: string;
  private readonly sourceId: string;
  private tileIndexAbortController?: AbortController;
  private tileIndexPromise?: Promise<GeoJSONVT>;

  constructor(options: GeojsonSourceCacheOptions) {
    if (options.source.type !== 'geojson') {
      throw new Error('GeojsonSourceCache only supports geojson sources.');
    }

    this.loadData = options.loadData ?? loadGeojsonData;
    this.readyTileBudget = options.readyTileBudget
      ?? new TileBudget({
        maxBytes: options.maxBytes ?? DEFAULT_SOURCE_CACHE_SIZE,
        maximumCacheOverflowBytes: options.maximumCacheOverflowBytes,
      });
    this.source = options.source;
    this.sourceId = options.sourceId;
    this.sourceSignature = JSON.stringify(options.source);
  }

  async requestTile(
    coordinate: TileCoordinate,
    priority: RequestPriority = 0,
  ): Promise<ArrayBuffer | undefined> {
    if (this.destroyed) {
      return undefined;
    }

    const key = createTileKey(
      this.sourceId,
      coordinate.level,
      coordinate.x,
      coordinate.y,
    );
    const existingEntry = this.entries.get(key);
    if (existingEntry?.state === 'ready' && existingEntry.value !== undefined) {
      this.readyTileBudget.touch(key);
      return cloneValue(existingEntry.value);
    }
    if (existingEntry?.promise) {
      if (existingEntry.priorityState) {
        const requestedPriority = resolvePriorityValue(priority);
        if (requestedPriority < existingEntry.priorityState.value) {
          existingEntry.priorityState.value = requestedPriority;
        }
      }

      return existingEntry.promise.then(v => v === undefined ? undefined : cloneValue(v));
    }

    const entry = existingEntry ?? this.createEntry(key);
    if (this.isRetryCoolingDown(entry)) {
      return Promise.reject(createThrottleError());
    }

    const priorityState = entry.priorityState ?? resolvePriorityState(priority);
    entry.priorityState = priorityState;

    const abortController = new AbortController();
    entry.abortController = abortController;
    entry.error = undefined;
    entry.state = 'requesting';
    entry.promise = this.waitForTileIndex(abortController.signal, priorityState)
      .then((tileIndex) => {
        if (this.destroyed) {
          throw createAbortError();
        }

        return getTileData(tileIndex, coordinate);
      })
      .then((value) => {
        if (this.destroyed || abortController.signal.aborted) {
          throw createAbortError();
        }

        const cachedValue = cloneValue(value);
        entry.abortController = undefined;
        entry.promise = undefined;
        entry.state = 'ready';
        entry.value = cachedValue;
        this.readyTileBudget.add(key, {
          byteLength: cachedValue.byteLength,
        }, (evictedKey) => {
          this.entries.delete(evictedKey);
        });
        return cloneValue(cachedValue);
      })
      .catch((error) => {
        entry.abortController = undefined;
        entry.promise = undefined;
        if (
          this.destroyed
          || abortController.signal.aborted
          || isAbortError(error)
          || isThrottleError(error)
        ) {
          entry.error = undefined;
          entry.state = 'idle';
          entry.failureCount = 0;
          entry.nextRetryAt = undefined;
          return undefined;
        }

        entry.error = error;
        entry.state = 'failed';
        entry.failureCount += 1;
        entry.nextRetryAt = Date.now() + calculateRetryDelay(entry.failureCount);
        throw error;
      });

    return entry.promise;
  }

  abortTile(key: string) {
    const entry = this.entries.get(key);
    entry?.abortController?.abort();
    if (!this.hasActiveTileRequests(key)) {
      this.tileIndexAbortController?.abort();
    }
  }

  updateSource(source: SourceSpecification) {
    if (source.type !== 'geojson') {
      throw new Error('GeojsonSourceCache only supports geojson sources.');
    }

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

  getEntry(key: string): SourceEntryRecord | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    return {
      abortController: entry.abortController,
      error: entry.error,
      failureCount: entry.failureCount,
      key: entry.key,
      promise: entry.promise,
      nextRetryAt: entry.nextRetryAt,
      state: entry.state,
      value: entry.value instanceof ArrayBuffer
        ? cloneValue(entry.value)
        : entry.value,
    };
  }

  peekEntryValue(key: string): ArrayBuffer | undefined {
    const entry = this.entries.get(key);
    if (!entry || !(entry.value instanceof ArrayBuffer)) {
      return undefined;
    }

    return entry.value;
  }

  getLoadedTileKeys(): string[] {
    return Array.from(this.entries.entries())
      .filter(([, entry]) => entry.state === 'ready' && entry.value !== undefined)
      .map(([key]) => key);
  }

  getMaxZoom(): number | undefined {
    return getSourceMaxZoom(this.source);
  }

  getMinZoom(): number | undefined {
    return getSourceMinZoom(this.source);
  }

  getNextRetryAt(): number | undefined {
    let nextRetryAt: number | undefined;

    for (const entry of this.entries.values()) {
      if (entry.state !== 'failed' || entry.nextRetryAt === undefined) {
        continue;
      }

      if (nextRetryAt === undefined || entry.nextRetryAt < nextRetryAt) {
        nextRetryAt = entry.nextRetryAt;
      }
    }

    return nextRetryAt;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.reset();
    this.destroyed = true;
  }

  private createEntry(key: string) {
    const entry: SourceEntryRecord = {
      failureCount: 0,
      key,
      state: 'idle',
    };
    this.entries.set(key, entry);
    return entry;
  }

  private isRetryCoolingDown(entry: SourceEntryRecord): boolean {
    return entry.state === 'failed'
      && entry.nextRetryAt !== undefined
      && Date.now() < entry.nextRetryAt;
  }

  private async getTileIndex(
    priority: RequestPriority,
  ): Promise<GeoJSONVT> {
    if (this.tileIndexPromise) {
      return this.tileIndexPromise;
    }

    const abortController = new AbortController();
    this.tileIndexAbortController = abortController;
    this.tileIndexPromise = this.loadData(
      this.source,
      abortController.signal,
      priority,
    )
      .then((data) => {
        if (abortController.signal.aborted) {
          throw createAbortError();
        }

        const tileIndex = new GeoJSONVT(
          cloneGeojson(data) as GeojsonTileIndexInput,
          createGeojsonTileIndexOptions(this.source),
        );
        this.tileIndexAbortController = undefined;
        return tileIndex;
      })
      .catch((error) => {
        this.tileIndexAbortController = undefined;
        this.tileIndexPromise = undefined;
        throw error;
      });

    return this.tileIndexPromise;
  }

  private waitForTileIndex(
    signal: AbortSignal,
    priority: RequestPriority,
  ): Promise<GeoJSONVT> {
    if (signal.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise<GeoJSONVT>((resolve, reject) => {
      const rejectAbort = () => {
        signal.removeEventListener('abort', rejectAbort);
        reject(createAbortError());
      };

      signal.addEventListener('abort', rejectAbort, {
        once: true,
      });
      void this.getTileIndex(priority).then((tileIndex) => {
        signal.removeEventListener('abort', rejectAbort);
        resolve(tileIndex);
      }).catch((error) => {
        signal.removeEventListener('abort', rejectAbort);
        reject(error);
      });
    });
  }

  private hasActiveTileRequests(excludedKey?: string): boolean {
    for (const [key, entry] of this.entries) {
      if (key === excludedKey) {
        continue;
      }

      if (
        entry.state === 'requesting'
        && !entry.abortController?.signal.aborted
      ) {
        return true;
      }
    }

    return false;
  }

  private reset() {
    this.tileIndexAbortController?.abort();
    this.tileIndexAbortController = undefined;
    this.tileIndexPromise = undefined;
    for (const key of Array.from(this.entries.keys())) {
      this.readyTileBudget.delete(key);
    }
    for (const entry of this.entries.values()) {
      entry.abortController?.abort();
    }
    this.entries.clear();
  }
}

function getTileData(tileIndex: GeoJSONVT, coordinate: TileCoordinate) {
  const tile = tileIndex.getTile(
    coordinate.level,
    coordinate.x,
    coordinate.y,
  );
  if (!tile) {
    return EMPTY_TILE_DATA;
  }

  // geojson-vt 的输出会重新编码成一张“合成向量瓦片”，
  // 这样 FeatureTile 提取阶段就能复用普通 MVT 的 source-layer 查找逻辑。
  const encoded = fromGeojsonVt({
    [GEOJSON_SOURCE_LAYER]: tile,
  } as GeojsonVtLayers);
  const tileBuffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(tileBuffer).set(encoded);
  return tileBuffer;
}

function loadGeojsonData(
  source: GeoJSONSourceSpecification,
  signal: AbortSignal,
  priority?: RequestPriority,
): Promise<GeoJsonObject> {
  if (typeof source.data !== 'string') {
    return Promise.resolve(source.data as GeoJsonObject);
  }

  return scheduleJsonRequest({
    priority,
    signal,
    url: source.data,
  }) as Promise<GeoJsonObject>;
}

function cloneGeojson(data: GeoJsonObject): GeoJsonObject {
  return deepClone(data);
}

function cloneValue(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0);
}

function calculateRetryDelay(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1);
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

function createGeojsonTileIndexOptions(
  source: GeoJSONSourceSpecification,
): GeojsonTileIndexOptions | undefined {
  const maxZoom = getSourceMaxZoom(source);
  if (maxZoom === undefined) {
    return undefined;
  }

  return {
    maxZoom,
  };
}

function getSourceMinZoom(source: SourceSpecification): number | undefined {
  const minzoom = (source as { minzoom?: unknown }).minzoom;
  return typeof minzoom === 'number' ? minzoom : undefined;
}

function getSourceMaxZoom(source: SourceSpecification): number | undefined {
  const maxzoom = (source as { maxzoom?: unknown }).maxzoom;
  return typeof maxzoom === 'number' ? maxzoom : undefined;
}

function resolvePriorityState(priority: RequestPriority): RequestPriorityState {
  if (typeof priority === 'object' && priority !== null) {
    return priority;
  }

  return {
    value: priority,
  };
}

function resolvePriorityValue(priority: RequestPriority): number {
  return typeof priority === 'object' && priority !== null
    ? priority.value
    : priority;
}
