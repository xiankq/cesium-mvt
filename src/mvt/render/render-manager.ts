import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { LayerFamily } from '../style/layer-family';
import type { BucketRenderedTileHandle } from './bucket-rendered-tile';
import {
  createBucketRenderedTileHandle,
  createEmptyBucketRenderedTileHandle,
  destroyBucketRenderedTileHandle,
  mountBucketRenderedTileHandle,
  setBucketRenderedTileVisibility,
} from './bucket-rendered-tile';
import { createRenderOrder } from './render-order';

export interface RenderManagerOptions {
  root: PrimitiveCollection;
}

export class RenderManager {
  private readonly root: PrimitiveCollection;
  private readonly renderedTileHandles = new Map<string, BucketRenderedTileHandle>();

  constructor(options: RenderManagerOptions) {
    this.root = options.root;
  }

  updateLayerFamilies(style: StyleSpecification, layerFamilies: LayerFamily[]): void {
    createRenderOrder(style, layerFamilies);
  }

  mount(key: string, bucketTile: ParsedTileResult, style: StyleSpecification): BucketRenderedTileHandle {
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

  show(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    return setBucketRenderedTileVisibility(handle, true);
  }

  hide(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    return setBucketRenderedTileVisibility(handle, false);
  }

  getHandle(key: string): BucketRenderedTileHandle | undefined {
    return this.renderedTileHandles.get(key);
  }

  hasHandle(key: string): boolean {
    return this.renderedTileHandles.has(key);
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
  }

  destroy(): void {
    this.clear();
  }
}
