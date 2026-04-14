import type { SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { WebMercatorTilingScheme } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { RenderTile } from '../render/render-tile';
import type { TileBudget } from '../utils/tile-budget';
import type { QueryableSourceCache, QuerySourceFeaturesOptions } from './source-query';
import type { TileCoordinate } from './tile-request';
import { createBucketTileDispatcher } from '../bucket';
import { parseRenderTileCoordinateFromKey } from '../render/render-tile';
import { isAbortError } from '../utils/common';
import { GeojsonSourceCache } from './geojson-source-cache';
import { isThrottleError } from './request-scheduler';
import { SourceCache } from './source-cache';
import { querySourceFeaturesFromCache } from './source-query';
import { createTileKey } from './tile-request';

/**
 * 瓦片数据源缓存接口
 *
 * 定义了不同类型数据源缓存的通用操作
 */
interface TileSourceCache extends QueryableSourceCache {
  abortTile?: (key: string) => void;
  destroy: () => void;
  getEntry?: (key: string) => {
    nextRetryAt?: number;
    state: string;
  } | undefined;
  getMaxZoom?: () => number | undefined;
  getMinZoom?: () => number | undefined;
  getNextRetryAt?: () => number | undefined;
  isDestroyed: () => boolean;
  requestTile: (
    coordinate: TileCoordinate,
    priority?: number,
  ) => Promise<ArrayBuffer | undefined>;
  updateSource: (source: SourceSpecification) => void;
}

/**
 * 待处理请求记录
 */
interface PendingRequest {
  abortController: AbortController;
  cleanup: () => void;
  promise: Promise<ParsedTileResult | undefined>;
}

/**
 * 数据源管理器
 *
 * 负责管理多个数据源缓存，协调瓦片请求和解析
 */
export class SourceManager {
  private destroyed = false;
  private readonly sourceCaches = new Map<string, TileSourceCache>();
  private readonly bucketTileDispatcher = createBucketTileDispatcher();
  private readonly readyTileBudget?: TileBudget;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(options: { readyTileBudget?: TileBudget } = {}) {
    this.readyTileBudget = options.readyTileBudget;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getSourceCache(sourceId: string): TileSourceCache | undefined {
    return this.sourceCaches.get(sourceId);
  }

  getSourceIds(): string[] {
    return Array.from(this.sourceCaches.keys());
  }

  querySourceFeatures(
    sourceId: string,
    options: QuerySourceFeaturesOptions = {},
  ) {
    return querySourceFeaturesFromCache(this.sourceCaches.get(sourceId), options);
  }

  getSourceConstraints(sourceId: string): {
    maxZoom?: number;
    minZoom?: number;
  } {
    const cache = this.sourceCaches.get(sourceId);
    return {
      maxZoom: cache?.getMaxZoom?.(),
      minZoom: cache?.getMinZoom?.(),
    };
  }

  getNextRetryAt(sourceIdOrKeys?: string | Iterable<string>): number | undefined {
    if (typeof sourceIdOrKeys === 'string') {
      return this.sourceCaches.get(sourceIdOrKeys)?.getNextRetryAt?.();
    }

    if (sourceIdOrKeys) {
      let nextRetryAt: number | undefined;

      for (const renderTileKey of sourceIdOrKeys) {
        let sourceKey: string;
        let sourceId: string;
        try {
          const coordinate = parseRenderTileCoordinateFromKey(renderTileKey);
          sourceId = coordinate.sourceId;
          sourceKey = createTileKey(
            coordinate.sourceId,
            coordinate.level,
            coordinate.x,
            coordinate.y,
          );
        }
        catch {
          continue;
        }

        const cache = this.sourceCaches.get(sourceId);
        const entry = cache?.getEntry?.(sourceKey);
        if (!entry || entry.state !== 'failed' || entry.nextRetryAt === undefined) {
          continue;
        }

        if (nextRetryAt === undefined || entry.nextRetryAt < nextRetryAt) {
          nextRetryAt = entry.nextRetryAt;
        }
      }

      return nextRetryAt;
    }

    let nextRetryAt: number | undefined;
    for (const cache of this.sourceCaches.values()) {
      const cacheNextRetryAt = cache.getNextRetryAt?.();
      if (cacheNextRetryAt === undefined) {
        continue;
      }

      if (nextRetryAt === undefined || cacheNextRetryAt < nextRetryAt) {
        nextRetryAt = cacheNextRetryAt;
      }
    }

    return nextRetryAt;
  }

  async requestTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
    renderTileKey: string,
    tilingScheme: WebMercatorTilingScheme,
    renderTile: RenderTile,
    style: StyleSpecification,
    priority = 0,
  ): Promise<ParsedTileResult | undefined> {
    const sourceCache = this.sourceCaches.get(sourceId);
    if (!sourceCache) {
      throw new Error(`Source cache not found: ${sourceId}`);
    }

    const existingRequest = this.pendingRequests.get(renderTileKey);
    if (existingRequest) {
      return existingRequest.promise;
    }

    const sourceTileKey = `${sourceId}/${level}/${x}/${y}`;
    const abortController = new AbortController();
    const abortSourceRequest = () => {
      sourceCache.abortTile?.(sourceTileKey);
    };
    abortController.signal.addEventListener('abort', abortSourceRequest, {
      once: true,
    });
    const cleanup = () => {
      abortController.signal.removeEventListener('abort', abortSourceRequest);
    };

    const requestPromise = (async () => {
      try {
        const tileData = await sourceCache.requestTile(
          { level, x, y },
          priority,
        );
        if (abortController.signal.aborted || tileData === undefined) {
          return undefined;
        }
        const bucketTile = await this.bucketTileDispatcher.compile({
          renderTile,
          style,
          signal: abortController.signal,
          tileData,
          tilingScheme,
        });
        if (abortController.signal.aborted) {
          return undefined;
        }
        return bucketTile;
      }
      catch (error) {
        if (isAbortError(error) || isThrottleError(error)) {
          return undefined;
        }
        throw error;
      }
      finally {
        this.pendingRequests.get(renderTileKey)?.cleanup();
        this.pendingRequests.delete(renderTileKey);
      }
    })();

    this.pendingRequests.set(renderTileKey, {
      abortController,
      cleanup,
      promise: requestPromise,
    });

    return requestPromise;
  }

  abort(key: string): void {
    const request = this.pendingRequests.get(key);
    if (request) {
      request.abortController.abort();
      request.cleanup();
      this.pendingRequests.delete(key);
    }
  }

  abortAll(): void {
    for (const request of this.pendingRequests.values()) {
      request.abortController.abort();
      request.cleanup();
    }
    this.pendingRequests.clear();
  }

  reconcileSources(sources: Record<string, SourceSpecification>): void {
    if (this.destroyed) {
      return;
    }

    const nextSourceIds = new Set(Object.keys(sources));

    for (const [sourceId, source] of Object.entries(sources)) {
      const sourceCache = this.sourceCaches.get(sourceId);
      if (sourceCache && sourceCache.sourceType === source.type) {
        sourceCache.updateSource(source);
        continue;
      }

      if (sourceCache) {
        sourceCache.destroy();
        this.sourceCaches.delete(sourceId);
      }

      const nextSourceCache = createTileSourceCache(
        sourceId,
        source,
        this.readyTileBudget,
      );
      if (nextSourceCache) {
        this.sourceCaches.set(sourceId, nextSourceCache);
      }
    }

    for (const [sourceId, sourceCache] of this.sourceCaches) {
      if (nextSourceIds.has(sourceId)) {
        continue;
      }

      sourceCache.destroy();
      this.sourceCaches.delete(sourceId);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.abortAll();
    for (const cache of this.sourceCaches.values()) {
      cache.destroy();
    }
    this.sourceCaches.clear();
    this.bucketTileDispatcher.destroy();
  }
}

function createTileSourceCache(
  sourceId: string,
  source: SourceSpecification,
  readyTileBudget?: TileBudget,
): TileSourceCache | undefined {
  if (source.type === 'vector') {
    return new SourceCache<ArrayBuffer>({
      readyTileBudget,
      source,
      sourceId,
    });
  }

  if (source.type === 'geojson') {
    return new GeojsonSourceCache({
      readyTileBudget,
      source,
      sourceId,
    });
  }

  return undefined;
}
