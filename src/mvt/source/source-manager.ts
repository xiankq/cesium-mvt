import type { SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { WebMercatorTilingScheme } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { TileCoordinate } from './tile-request';
import { createBucketTileDispatcher } from '../bucket';
import { GeojsonSourceCache } from './geojson-source-cache';
import { SourceCache } from './source-cache';

/**
 * 瓦片数据源缓存接口
 *
 * 定义了不同类型数据源缓存的通用操作
 */
interface TileSourceCache {
  abortTile?: (key: string) => void;
  destroy: () => void;
  getMaxZoom?: () => number | undefined;
  getMinZoom?: () => number | undefined;
  isDestroyed: () => boolean;
  readonly sourceType: SourceSpecification['type'];
  requestTile: (coordinate: TileCoordinate) => Promise<ArrayBuffer>;
  updateSource: (source: SourceSpecification) => void;
}

/**
 * 待处理请求记录
 */
interface PendingRequest {
  abortController: AbortController;
  cleanup: () => void;
}

/**
 * 数据源管理器
 *
 * 负责管理多个数据源缓存，协调瓦片请求和解析
 */
export class SourceManager {
  private readonly sourceCaches = new Map<string, TileSourceCache>();
  private readonly bucketTileDispatcher = createBucketTileDispatcher();
  private readonly pendingRequests = new Map<string, PendingRequest>();

  getSourceCache(sourceId: string): TileSourceCache | undefined {
    return this.sourceCaches.get(sourceId);
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

  async requestTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
    renderTileKey: string,
    tilingScheme: WebMercatorTilingScheme,
    onCompile: (tile: ParsedTileResult) => void,
  ): Promise<ParsedTileResult> {
    const sourceCache = this.sourceCaches.get(sourceId);
    if (!sourceCache) {
      throw new Error(`Source cache not found: ${sourceId}`);
    }

    const sourceTileKey = `${sourceId}/${level}/${x}/${y}`;
    const abortController = new AbortController();
    const abortSourceRequest = () => {
      sourceCache.abortTile?.(sourceTileKey);
    };
    abortController.signal.addEventListener('abort', abortSourceRequest, {
      once: true,
    });

    this.pendingRequests.set(renderTileKey, {
      abortController,
      cleanup: () => {
        abortController.signal.removeEventListener('abort', abortSourceRequest);
      },
    });

    try {
      const tileData = await sourceCache.requestTile({ level, x, y });
      const bucketTile = await this.bucketTileDispatcher.compile({
        renderTile: {
          key: renderTileKey,
        } as any,
        signal: abortController.signal,
        tileData,
        tilingScheme,
      });
      onCompile(bucketTile);
      return bucketTile;
    }
    finally {
      this.pendingRequests.get(renderTileKey)?.cleanup();
      this.pendingRequests.delete(renderTileKey);
    }
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
    const nextSourceIds = new Set(Object.keys(sources));

    for (const [sourceId, source] of Object.entries(sources)) {
      const sourceCache = this.sourceCaches.get(sourceId);
      if (sourceCache && sourceCache.sourceType === source.type) {
        sourceCache.updateSource(source);
        continue;
      }

      sourceCache?.destroy();
      this.sourceCaches.delete(sourceId);

      const nextSourceCache = createTileSourceCache(sourceId, source);
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
): TileSourceCache | undefined {
  if (source.type === 'vector') {
    return new SourceCache<ArrayBuffer>({
      source,
      sourceId,
    });
  }

  if (source.type === 'geojson') {
    return new GeojsonSourceCache({
      source,
      sourceId,
    });
  }

  return undefined;
}
