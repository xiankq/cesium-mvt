import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { LayerFamily } from '../style/layer-family';
import type { BucketSymbolPlacementHandle } from './backend/bucket-symbol-types';
import type { SymbolPlacementIndexPlacement } from './backend/symbol-placement-index';
import type { BucketRenderedTileHandle } from './bucket-rendered-tile';
import type { RenderEntry } from './render-order';
import { createSymbolPlacementIndex } from './backend/symbol-placement-index';
import {
  createBucketRenderedTileHandle,
  destroyBucketRenderedTileHandle,
  mountBucketRenderedTileHandle,
  setBucketRenderedTileVisibility,
} from './bucket-rendered-tile';
import { createRenderOrder } from './render-order';
import { parseRenderTileCoordinateFromKey } from './render-tile';

export interface RenderManagerOptions {
  root: PrimitiveCollection;
  tileWidth?: number;
}

export class RenderManager {
  private readonly root: PrimitiveCollection;
  private readonly tileWidth: number;
  private readonly renderedTileHandles = new Map<string, BucketRenderedTileHandle>();
  private renderOrder: RenderEntry[] = [];
  private layerFamilies: LayerFamily[] = [];
  private featureStateResolver?: FeatureStateResolver;
  private style?: StyleSpecification;

  constructor(options: RenderManagerOptions) {
    this.root = options.root;
    this.tileWidth = options.tileWidth ?? 256;
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

  setFeatureStateResolver(resolver?: FeatureStateResolver): void {
    this.featureStateResolver = resolver;
  }

  mount(key: string, bucketTile: ParsedTileResult, style: StyleSpecification): BucketRenderedTileHandle {
    const existingHandle = this.renderedTileHandles.get(key);
    if (existingHandle) {
      return existingHandle;
    }

    const handle = createBucketRenderedTileHandle({
      bucketTile,
      featureStateResolver: this.featureStateResolver,
      tileWidth: this.tileWidth,
      style,
    });

    mountBucketRenderedTileHandle(this.root, handle);
    this.renderedTileHandles.set(key, handle);
    this.reconcileSymbolPlacements();
    return handle;
  }

  refresh(
    key: string,
    bucketTile: ParsedTileResult,
    style: StyleSpecification,
  ): BucketRenderedTileHandle {
    const existingHandle = this.renderedTileHandles.get(key);
    if (!existingHandle) {
      return this.mount(key, bucketTile, style);
    }

    const wasVisible = existingHandle.visible;
    const nextHandle = createBucketRenderedTileHandle({
      bucketTile,
      featureStateResolver: this.featureStateResolver,
      tileWidth: this.tileWidth,
      style,
    });

    destroyBucketRenderedTileHandle(this.root, existingHandle);
    mountBucketRenderedTileHandle(this.root, nextHandle);
    if (!wasVisible) {
      setBucketRenderedTileVisibility(nextHandle, false);
    }

    this.renderedTileHandles.set(key, nextHandle);
    this.reconcileSymbolPlacements();
    return nextHandle;
  }

  refreshSource(
    sourceId: string,
    getBucketTile: (key: string) => ParsedTileResult | undefined,
    style: StyleSpecification,
  ): void {
    for (const key of this.getAllKeys()) {
      const renderTileCoordinate = parseRenderTileCoordinateFromKey(key);
      if (renderTileCoordinate.sourceId !== sourceId) {
        continue;
      }

      const bucketTile = getBucketTile(key);
      if (!bucketTile) {
        continue;
      }

      this.refresh(key, bucketTile, style);
    }
  }

  show(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    const changed = setBucketRenderedTileVisibility(handle, true);
    if (changed) {
      this.reconcileSymbolPlacements();
    }
    return changed;
  }

  hide(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    const changed = setBucketRenderedTileVisibility(handle, false);
    if (changed) {
      this.reconcileSymbolPlacements();
    }
    return changed;
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
    this.reconcileSymbolPlacements();
    return true;
  }

  clear(): void {
    for (const handle of this.renderedTileHandles.values()) {
      destroyBucketRenderedTileHandle(this.root, handle);
    }
    this.renderedTileHandles.clear();
    this.reconcileSymbolPlacements();
  }

  destroy(): void {
    this.clear();
  }

  private reconcileSymbolPlacements(): void {
    const symbolTileHandles = Array.from(this.renderedTileHandles.values())
      .filter(handle => handle.visible && handle.symbols?.placements.length)
      .map(handle => ({
        coordinate: parseRenderTileCoordinateFromKey(handle.key),
        handle,
      }));

    if (symbolTileHandles.length === 0) {
      return;
    }

    symbolTileHandles.sort((left, right) => {
      // 先让更高 zoom 的瓦片占位，和 MapLibre 一样优先保留更细粒度的数据。
      if (left.coordinate.level !== right.coordinate.level) {
        return right.coordinate.level - left.coordinate.level;
      }

      return left.handle.key.localeCompare(right.handle.key);
    });

    const placementIndex = createSymbolPlacementIndex();

    for (const { coordinate, handle } of symbolTileHandles) {
      for (const placement of handle.symbols!.placements) {
        const indexedPlacement = this.toSymbolPlacementIndexPlacement(
          placement,
          coordinate.level,
        );
        const visible = !placementIndex.hasMatch(indexedPlacement);
        this.setSymbolPlacementVisibility(placement, visible);
        if (!visible) {
          continue;
        }

        placementIndex.insert(indexedPlacement);
      }
    }
  }

  private toSymbolPlacementIndexPlacement(
    placement: BucketSymbolPlacementHandle,
    level: number,
  ): SymbolPlacementIndexPlacement {
    return {
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      collision: placement.collision,
      key: placement.key,
      level,
    };
  }

  private setSymbolPlacementVisibility(
    placement: BucketSymbolPlacementHandle,
    visible: boolean,
  ): void {
    for (const renderable of placement.renderables) {
      renderable.collection.get(renderable.index).show = visible;
    }
  }
}
