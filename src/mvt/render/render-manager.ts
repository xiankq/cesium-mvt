import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { LayerFamily } from '../style/layer-family';
import type {
  BucketSymbolPlacementHandle,
  BucketSymbolPlacementPartHandle,
} from './backend/bucket-symbol-types';
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
  crossSourceCollisions?: boolean;
  tileWidth?: number;
}

interface SymbolPlacementTarget {
  coordinate: ReturnType<typeof parseRenderTileCoordinateFromKey>;
  handle: BucketRenderedTileHandle;
  placement: BucketSymbolPlacementHandle;
  part: BucketSymbolPlacementPartHandle;
  partIndex: number;
}

export class RenderManager {
  private readonly root: PrimitiveCollection;
  private readonly tileWidth: number;
  private readonly crossSourceCollisions: boolean;
  private readonly renderedTileHandles = new Map<string, BucketRenderedTileHandle>();
  private renderOrder: RenderEntry[] = [];
  private layerFamilies: LayerFamily[] = [];
  private featureStateResolver?: FeatureStateResolver;
  private style?: StyleSpecification;

  constructor(options: RenderManagerOptions) {
    this.root = options.root;
    this.tileWidth = options.tileWidth ?? 256;
    this.crossSourceCollisions = options.crossSourceCollisions ?? true;
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
    const symbolPlacements = Array.from(this.renderedTileHandles.values())
      .filter(handle => handle.visible && handle.symbols?.placements.length)
      .flatMap((handle) => {
        const coordinate = parseRenderTileCoordinateFromKey(handle.key);
        return handle.symbols!.placements.flatMap((placement) => {
          return placement.collisionParts.map((part, partIndex) => ({
            coordinate,
            handle,
            part,
            partIndex,
            placement,
          }));
        });
      });

    if (symbolPlacements.length === 0) {
      return;
    }

    symbolPlacements.sort(compareSymbolPlacementTargets);

    if (this.crossSourceCollisions) {
      this.reconcileSymbolPlacementsForTargets(symbolPlacements);
      return;
    }

    // 关闭 crossSourceCollisions 时，source 之间不共享碰撞预算，但同一 source 内仍然要按空间关系隐藏重叠符号。
    const targetsBySourceId = new Map<string, SymbolPlacementTarget[]>();
    for (const target of symbolPlacements) {
      const sourceTargets = targetsBySourceId.get(target.coordinate.sourceId);
      if (sourceTargets) {
        sourceTargets.push(target);
      }
      else {
        targetsBySourceId.set(target.coordinate.sourceId, [target]);
      }
    }

    for (const targets of targetsBySourceId.values()) {
      this.reconcileSymbolPlacementsForTargets(targets);
    }
  }

  private reconcileSymbolPlacementsForTargets(
    symbolTileHandles: SymbolPlacementTarget[],
  ): void {
    const placementIndex = createSymbolPlacementIndex({
      tileWidth: this.tileWidth,
    });

    for (const { coordinate, handle, part, placement } of symbolTileHandles) {
      const indexedPlacement = this.toSymbolPlacementIndexPlacement(
        placement,
        part,
        coordinate.level,
        handle.key,
      );
      const visible = !placementIndex.hasMatch(indexedPlacement);
      this.setSymbolPlacementVisibility(part, visible);
      if (!visible) {
        continue;
      }

      placementIndex.insert(indexedPlacement);
    }
  }

  private toSymbolPlacementIndexPlacement(
    placement: BucketSymbolPlacementHandle,
    part: BucketSymbolPlacementPartHandle,
    level: number,
    tileKey: string,
  ): SymbolPlacementIndexPlacement {
    return {
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      collision: part.collision,
      groupKey: part.groupKey,
      key: placement.key,
      level,
      tileKey,
    };
  }

  private setSymbolPlacementVisibility(
    part: BucketSymbolPlacementPartHandle,
    visible: boolean,
  ): void {
    for (const renderable of part.renderables) {
      renderable.collection.get(renderable.index).show = visible;
    }
  }
}

function compareSymbolPlacementTargets(
  left: SymbolPlacementTarget,
  right: SymbolPlacementTarget,
): number {
  if (
    left.placement.zOrder !== 'viewport-y'
    && right.placement.zOrder !== 'viewport-y'
    && (left.placement.sortKey !== undefined || right.placement.sortKey !== undefined)
  ) {
    const leftSortKey = left.placement.sortKey ?? 0;
    const rightSortKey = right.placement.sortKey ?? 0;
    if (leftSortKey !== rightSortKey) {
      return leftSortKey - rightSortKey;
    }
  }

  if (left.coordinate.level !== right.coordinate.level) {
    // 先让更高 zoom 的瓦片占位，保留更细粒度的数据。
    return right.coordinate.level - left.coordinate.level;
  }

  if (left.placement.sourceIndex !== right.placement.sourceIndex) {
    return left.placement.sourceIndex - right.placement.sourceIndex;
  }

  if (left.partIndex !== right.partIndex) {
    return left.partIndex - right.partIndex;
  }

  return left.handle.key.localeCompare(right.handle.key);
}
