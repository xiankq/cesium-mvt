import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { LayerFamily } from '../style/layer-family';
import type { BucketRenderedTileHandle } from './bucket-rendered-tile';
import type { RenderEntry } from './render-order';
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
  private renderOrder: RenderEntry[] = [];
  private layerFamilies: LayerFamily[] = [];
  private style?: StyleSpecification;

  constructor(options: RenderManagerOptions) {
    this.root = options.root;
  }

  updateLayerFamilies(style: StyleSpecification, layerFamilies: LayerFamily[]): void {
    this.style = style;
    this.layerFamilies = layerFamilies;
    this.renderOrder = createRenderOrder(style, layerFamilies);
  }

  getRenderOrder(): RenderEntry[] {
    return this.renderOrder;
  }

  getLayerFamilies(): LayerFamily[] {
    return this.layerFamilies;
  }

  getStyle(): StyleSpecification | undefined {
    return this.style;
  }

  mount(key: string, bucketTile: ParsedTileResult, style: StyleSpecification): BucketRenderedTileHandle {
    const existingHandle = this.renderedTileHandles.get(key);
    if (existingHandle) {
      return existingHandle;
    }

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

  getAllKeys(): string[] {
    return Array.from(this.renderedTileHandles.keys());
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
