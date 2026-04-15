import type {
  SourceSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { RequestPriority, RequestPriorityState } from './request-scheduler';
import type { TileCoordinate, TileRequest } from './tile-request';
import { createAbortError, isAbortError, resolveUrl } from '../utils/common';
import { TileBudget } from '../utils/tile-budget';
import {
  createThrottleError,
  isThrottleError,

  scheduleJsonRequest,
  scheduleTileRequest,
} from './request-scheduler';
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
  failureCount?: number;
  nextRetryAt?: number;
  state: SourceEntryState;
  value?: TValue;
}

export type SourceEntryState = 'failed' | 'idle' | 'ready' | 'requesting';

interface SourceEntryRecord<TValue> extends SourceEntry<TValue> {
  abortController?: AbortController;
  failureCount: number;
  priorityState?: RequestPriorityState;
  promise?: Promise<TValue | undefined>;
  nextRetryAt?: number;
}

interface SourceCacheOptions<TValue> {
  loadTile?: (
    request: TileRequest,
    signal: AbortSignal,
    priority?: RequestPriority,
  ) => Promise<TValue>;
  loadTileJson?: (
    url: string,
    signal: AbortSignal,
    priority?: RequestPriority,
  ) => Promise<TileJson>;
  maxBytes?: number;
  maximumCacheOverflowBytes?: number;
  readyTileBudget?: TileBudget;
  source: SourceSpecification;
  sourceId: string;
}

const DEFAULT_SOURCE_ENTRY_STATE: SourceEntryState = 'idle';
const DEFAULT_SOURCE_CACHE_SIZE = 64 * 1024 * 1024;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

export class SourceCache<TValue extends ArrayBuffer = ArrayBuffer> {
  readonly sourceType: SourceSpecification['type'];

  private destroyed = false;
  private readonly entries = new Map<string, SourceEntryRecord<TValue>>();
  private readonly readyTileKeys = new Set<string>();
  private readonly activeRequestKeys = new Set<string>();
  private readonly failedRetryAtByKey = new Map<string, number>();
  private readonly readyTileBudget: TileBudget;
  private readonly loadTile: (
    request: TileRequest,
    signal: AbortSignal,
    priority?: RequestPriority,
  ) => Promise<TValue>;

  private readonly loadTileJson: (
    url: string,
    signal: AbortSignal,
    priority?: RequestPriority,
  ) => Promise<TileJson>;

  private source: SourceSpecification;
  private sourceSignature: string;
  private readonly sourceId: string;
  private tileJsonAbortController?: AbortController;
  private tileJsonPromise?: Promise<TileJson>;
  private cachedTileJson?: TileJson;
  private failedRetryMin?: {
    key: string;
    value: number;
  };

  private failedRetryMinDirty = false;

  constructor(options: SourceCacheOptions<TValue>) {
    this.loadTile
      = options.loadTile
        ?? (loadTileBuffer as (
          request: TileRequest,
          signal: AbortSignal,
          priority?: RequestPriority,
        ) => Promise<TValue>);
    this.loadTileJson = options.loadTileJson ?? loadTileJson;
    this.readyTileBudget = options.readyTileBudget
      ?? new TileBudget({
        maxBytes: options.maxBytes ?? DEFAULT_SOURCE_CACHE_SIZE,
        maximumCacheOverflowBytes: options.maximumCacheOverflowBytes,
      });
    this.source = options.source;
    this.sourceType = options.source.type;
    this.sourceId = options.sourceId;
    this.sourceSignature = JSON.stringify(options.source);
  }

  async requestTile(
    coordinate: TileCoordinate,
    priority: RequestPriority = 0,
  ): Promise<TValue | undefined> {
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

      return existingEntry.promise.then(v => v === undefined ? undefined : cloneValue(v)) as Promise<TValue | undefined>;
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
    this.activeRequestKeys.add(key);

    const requestPromise = this.resolveTileRequest(coordinate, priorityState)
      .then((request) => {
        if (this.destroyed) {
          throw createAbortError();
        }

        return this.loadTile(
          request,
          abortController.signal,
          priorityState,
        );
      })
      .then((value) => {
        if (this.destroyed || abortController.signal.aborted) {
          throw createAbortError();
        }

        entry.state = 'ready';
        entry.value = value;
        entry.error = undefined;
        entry.failureCount = 0;
        entry.nextRetryAt = undefined;
        this.readyTileKeys.add(key);
        this.clearFailedRetryAt(key);
        this.readyTileBudget.add(key, {
          byteLength: getValueByteLength(value),
        }, (evictedKey) => {
          this.removeEntry(evictedKey);
        });
        return value;
      })
      .catch((error) => {
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
          this.readyTileKeys.delete(key);
          this.clearFailedRetryAt(key);
          return undefined as TValue | undefined;
        }

        entry.error = error;
        entry.state = 'failed';
        entry.failureCount += 1;
        entry.nextRetryAt = Date.now() + calculateRetryDelay(entry.failureCount);
        this.readyTileKeys.delete(key);
        this.markFailed(key, entry.nextRetryAt);
        throw error;
      })
      .finally(() => {
        entry.abortController = undefined;
        entry.promise = undefined;
        this.activeRequestKeys.delete(key);
      });

    entry.promise = requestPromise;

    return requestPromise.then(v => v === undefined ? undefined : cloneValue(v)) as Promise<TValue | undefined>;
  }

  abortTile(key: string) {
    this.activeRequestKeys.delete(key);
    this.entries.get(key)?.abortController?.abort();
    if (!this.hasActiveTileRequests()) {
      this.tileJsonAbortController?.abort();
    }
  }

  getNextRetryAt(): number | undefined {
    if (this.failedRetryMinDirty) {
      this.recomputeFailedRetryMin();
    }

    return this.failedRetryMin?.value;
  }

  getEntry(key: string): SourceEntry<TValue> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    return {
      error: entry.error,
      failureCount: entry.failureCount,
      key: entry.key,
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
    return Array.from(this.readyTileKeys);
  }

  forEachLoadedTileKey(visitor: (key: string) => void): void {
    for (const key of this.readyTileKeys) {
      visitor(key);
    }
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

  private hasActiveTileRequests(): boolean {
    return this.activeRequestKeys.size > 0;
  }

  private createEntry(key: string) {
    const entry: SourceEntryRecord<TValue> = {
      failureCount: 0,
      key,
      state: DEFAULT_SOURCE_ENTRY_STATE,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private isRetryCoolingDown(entry: SourceEntryRecord<TValue>): boolean {
    return entry.state === 'failed'
      && entry.nextRetryAt !== undefined
      && Date.now() < entry.nextRetryAt;
  }

  private markFailed(key: string, nextRetryAt: number): void {
    this.failedRetryAtByKey.set(key, nextRetryAt);
    if (!this.failedRetryMin || nextRetryAt < this.failedRetryMin.value) {
      this.failedRetryMin = {
        key,
        value: nextRetryAt,
      };
      this.failedRetryMinDirty = false;
      return;
    }

    if (this.failedRetryMin.key === key) {
      if (nextRetryAt > this.failedRetryMin.value) {
        this.failedRetryMin.value = nextRetryAt;
        this.failedRetryMinDirty = true;
      }
      else {
        this.failedRetryMin.value = nextRetryAt;
      }
    }
  }

  private clearFailedRetryAt(key: string): void {
    if (!this.failedRetryAtByKey.delete(key)) {
      return;
    }

    if (this.failedRetryMin?.key === key) {
      this.failedRetryMinDirty = true;
    }
  }

  private recomputeFailedRetryMin(): void {
    let nextRetryAt: {
      key: string;
      value: number;
    } | undefined;

    for (const [key, value] of this.failedRetryAtByKey) {
      if (!nextRetryAt || value < nextRetryAt.value) {
        nextRetryAt = {
          key,
          value,
        };
      }
    }

    this.failedRetryMin = nextRetryAt;
    this.failedRetryMinDirty = false;
  }

  private removeEntry(key: string): void {
    this.readyTileKeys.delete(key);
    this.activeRequestKeys.delete(key);
    this.clearFailedRetryAt(key);
    this.entries.delete(key);
  }

  private reset() {
    this.tileJsonAbortController?.abort();
    this.tileJsonAbortController = undefined;
    this.tileJsonPromise = undefined;
    this.cachedTileJson = undefined;
    for (const key of Array.from(this.entries.keys())) {
      this.readyTileBudget.delete(key);
    }
    for (const entry of this.entries.values()) {
      entry.abortController?.abort();
    }
    this.entries.clear();
    this.readyTileKeys.clear();
    this.activeRequestKeys.clear();
    this.failedRetryAtByKey.clear();
    this.failedRetryMin = undefined;
    this.failedRetryMinDirty = false;
  }

  private async resolveTileRequest(
    coordinate: TileCoordinate,
    priority: RequestPriority,
  ) {
    const tileJson = await this.getTileJson(priority);
    return createTileRequest({
      coordinate,
      scheme: tileJson.scheme ?? getDefaultSourceScheme(this.source),
      sourceId: this.sourceId,
      tiles: tileJson.tiles ?? [],
    });
  }

  private async getTileJson(
    priority: RequestPriority,
  ): Promise<TileJson> {
    if (hasInlineTiles(this.source)) {
      const inlineTileJson: TileJson = {
        scheme: getDefaultSourceScheme(this.source),
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
      priority,
    ).then((tileJson) => {
      if (abortController.signal.aborted) {
        throw createAbortError();
      }

      const normalized = normalizeTileJson(
        tileJson,
        tileJsonUrl,
        this.source,
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
    return getSourceMaxZoom(this.source) ?? this.cachedTileJson?.maxzoom;
  }

  getMinZoom(): number | undefined {
    return getSourceMinZoom(this.source) ?? this.cachedTileJson?.minzoom;
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

function getDeclaredSourceScheme(source: SourceSpecification): 'tms' | 'xyz' | undefined {
  if ('scheme' in source && (source.scheme === 'tms' || source.scheme === 'xyz')) {
    return source.scheme;
  }

  return undefined;
}

function normalizeTileJson(
  tileJson: TileJson,
  tileJsonUrl: string,
  source: SourceSpecification,
): TileJson {
  return {
    maxzoom: tileJson.maxzoom,
    minzoom: tileJson.minzoom,
    scheme: getDeclaredSourceScheme(source) ?? tileJson.scheme ?? 'xyz',
    tiles: tileJson.tiles?.map(tileUrl => resolveUrl(tileUrl, tileJsonUrl)),
  };
}

function getDefaultSourceScheme(source: SourceSpecification) {
  return getDeclaredSourceScheme(source) ?? 'xyz';
}

function loadTileJson(
  url: string,
  signal: AbortSignal,
  priority?: RequestPriority,
) {
  return scheduleJsonRequest({
    priority,
    signal,
    url,
  }) as Promise<TileJson>;
}

function loadTileBuffer(
  request: TileRequest,
  signal: AbortSignal,
  priority?: RequestPriority,
): Promise<ArrayBuffer> {
  return scheduleTileRequest({
    priority,
    signal,
    url: request.url,
  });
}

function cloneValue<TValue>(value: TValue): TValue {
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as TValue;
  }

  return value;
}

function getValueByteLength<TValue>(value: TValue): number {
  return value instanceof ArrayBuffer ? value.byteLength : 0;
}

function calculateRetryDelay(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1);
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
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
