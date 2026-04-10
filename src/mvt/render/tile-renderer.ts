import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { BucketRenderedTileHandle } from './bucket-rendered-tile';
import { TileCache } from '../utils/tile-cache';
import {
  createBucketRenderedTileHandle,
  createEmptyBucketRenderedTileHandle,
  destroyBucketRenderedTileHandle,
  mountBucketRenderedTileHandle,
  setBucketRenderedTileVisibility,
} from './bucket-rendered-tile';

const DEFAULT_HIDDEN_CACHE_SIZE = 64 * 1024 * 1024;

export class TileRenderer {
  private readonly root: PrimitiveCollection;
  private readonly renderedTileHandles = new Map<string, BucketRenderedTileHandle>();
  private readonly hiddenRenderedTileCache: TileCache;
  private readonly pendingRenderedTiles = new Map<string, Promise<BucketRenderedTileHandle>>();

  constructor(root: PrimitiveCollection) {
    this.root = root;
    this.hiddenRenderedTileCache = new TileCache({ maxBytes: DEFAULT_HIDDEN_CACHE_SIZE });
  }

  getHandle(key: string): BucketRenderedTileHandle | undefined {
    return this.renderedTileHandles.get(key);
  }

  getPending(key: string): Promise<BucketRenderedTileHandle> | undefined {
    return this.pendingRenderedTiles.get(key);
  }

  setPending(key: string, promise: Promise<BucketRenderedTileHandle>): void {
    this.pendingRenderedTiles.set(key, promise);
  }

  deletePending(key: string): void {
    this.pendingRenderedTiles.delete(key);
  }

  hasHandle(key: string): boolean {
    return this.renderedTileHandles.has(key);
  }

  hasPending(key: string): boolean {
    return this.pendingRenderedTiles.has(key);
  }

  mount(
    key: string,
    bucketTile: ParsedTileResult,
    style: StyleSpecification,
  ): BucketRenderedTileHandle {
    const handle = createBucketRenderedTileHandle({
      bucketTile,
      style,
    });
    mountBucketRenderedTileHandle(this.root, handle);
    this.renderedTileHandles.set(key, handle);
    return handle;
  }

  setEmpty(key: string): BucketRenderedTileHandle {
    const handle = createEmptyBucketRenderedTileHandle(key);
    this.renderedTileHandles.set(key, handle);
    return handle;
  }

  setVisible(key: string, visible: boolean): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    return setBucketRenderedTileVisibility(handle, visible);
  }

  hide(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }

    const changed = setBucketRenderedTileVisibility(handle, false);
    if (changed) {
      this.cacheHiddenHandle(key, handle);
    }
    return changed;
  }

  show(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    return setBucketRenderedTileVisibility(handle, true);
  }

  remove(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }

    destroyBucketRenderedTileHandle(this.root, handle);
    this.renderedTileHandles.delete(key);
    return true;
  }

  clear(): void {
    for (const handle of this.renderedTileHandles.values()) {
      destroyBucketRenderedTileHandle(this.root, handle);
    }
    this.renderedTileHandles.clear();
    this.hiddenRenderedTileCache.clear();
    this.pendingRenderedTiles.clear();
  }

  destroy(): void {
    this.clear();
  }

  private cacheHiddenHandle(key: string, handle: BucketRenderedTileHandle): void {
    this.hiddenRenderedTileCache.add(key, {
      byteLength: handle.byteLength,
      key,
    });
  }
}
