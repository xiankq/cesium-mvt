import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection } from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { LayerFamily } from '../style/layer-family';
import type { StyleIndex } from '../style/style-manager';
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
import { parseRenderTileCoordinateFromKey, stripRenderTileScope } from './render-tile';

export interface RenderManagerOptions {
  root: PrimitiveCollection;
  crossSourceCollisions?: boolean;
  tileWidth?: number;
}

export interface RenderManagerMetrics {
  hideCount: number;
  mountCount: number;
  removeCount: number;
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
  private readonly allKeys = new Set<string>();
  private readonly visibleKeys = new Set<string>();
  private readonly keysBySourceId = new Map<string, Set<string>>();
  private readonly allKeySnapshot: string[] = [];
  private readonly visibleKeySnapshot: string[] = [];
  private readonly keysBySourceIdSnapshot = new Map<string, string[]>();
  private readonly coordinateByKey = new Map<string, ReturnType<typeof parseRenderTileCoordinateFromKey> & {
    rawKey: string;
  }>();

  private renderOrder: RenderEntry[] = [];
  private layerFamilies: LayerFamily[] = [];
  private featureStateResolver?: FeatureStateResolver;
  private style?: StyleSpecification;
  private readonly metrics: RenderManagerMetrics = {
    hideCount: 0,
    mountCount: 0,
    removeCount: 0,
  };

  constructor(options: RenderManagerOptions) {
    this.root = options.root;
    this.tileWidth = options.tileWidth ?? 256;
    this.crossSourceCollisions = options.crossSourceCollisions ?? true;
  }

  updateLayerFamilies(
    style: StyleSpecification,
    layerFamilies: LayerFamily[],
    renderOrder?: RenderEntry[],
  ): void {
    this.style = style;
    this.layerFamilies = layerFamilies;
    this.renderOrder = renderOrder ?? createRenderOrder(style, layerFamilies);
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

  mount(
    key: string,
    bucketTile: ParsedTileResult,
    style: StyleSpecification,
    styleIndex?: StyleIndex,
  ): BucketRenderedTileHandle {
    const existingHandle = this.renderedTileHandles.get(key);
    if (existingHandle) {
      return existingHandle;
    }

    const handle = createBucketRenderedTileHandle({
      bucketTile,
      featureStateResolver: this.featureStateResolver,
      tileWidth: this.tileWidth,
      style,
      styleIndex,
    });

    mountBucketRenderedTileHandle(this.root, handle);
    this.metrics.mountCount += 1;
    this.renderedTileHandles.set(key, handle);
    this.addKeySnapshot(key, handle);
    this.reconcileSymbolPlacements();
    return handle;
  }

  refresh(
    key: string,
    bucketTile: ParsedTileResult,
    style: StyleSpecification,
    styleIndex?: StyleIndex,
  ): BucketRenderedTileHandle {
    const existingHandle = this.renderedTileHandles.get(key);
    if (!existingHandle) {
      return this.mount(key, bucketTile, style, styleIndex);
    }

    const wasVisible = existingHandle.visible;
    const nextHandle = createBucketRenderedTileHandle({
      bucketTile,
      featureStateResolver: this.featureStateResolver,
      tileWidth: this.tileWidth,
      style,
      styleIndex,
    });

    this.metrics.removeCount += 1;
    destroyBucketRenderedTileHandle(this.root, existingHandle);
    mountBucketRenderedTileHandle(this.root, nextHandle);
    this.metrics.mountCount += 1;
    if (!wasVisible) {
      setBucketRenderedTileVisibility(nextHandle, false);
    }

    this.renderedTileHandles.set(key, nextHandle);
    this.updateVisibilitySnapshot(key, nextHandle.visible);
    this.addKeySnapshot(key, nextHandle);
    this.reconcileSymbolPlacements();
    return nextHandle;
  }

  refreshSource(
    sourceId: string,
    getBucketTile: (key: string) => ParsedTileResult | undefined,
    style: StyleSpecification,
    styleIndex?: StyleIndex,
  ): void {
    this.refreshSourceKeys(sourceId, getBucketTile, style, styleIndex);
  }

  refreshSourceLayer(
    sourceId: string,
    sourceLayer: string,
    getBucketTile: (key: string) => ParsedTileResult | undefined,
    style: StyleSpecification,
    styleIndex?: StyleIndex,
  ): void {
    this.refreshSourceKeys(
      sourceId,
      getBucketTile,
      style,
      styleIndex,
      sourceLayer,
    );
  }

  show(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }
    const changed = setBucketRenderedTileVisibility(handle, true);
    if (changed) {
      this.updateVisibilitySnapshot(key, true);
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
      this.metrics.hideCount += 1;
      this.updateVisibilitySnapshot(key, false);
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
    return this.allKeySnapshot;
  }

  getVisibleKeys(): string[] {
    return this.visibleKeySnapshot;
  }

  getCoordinate(key: string): (ReturnType<typeof parseRenderTileCoordinateFromKey> & {
    rawKey: string;
  }) | undefined {
    return this.coordinateByKey.get(key);
  }

  getKeysForSource(sourceId: string): string[] {
    return this.keysBySourceIdSnapshot.get(sourceId) ?? [];
  }

  getMetrics(): RenderManagerMetrics {
    return {
      ...this.metrics,
    };
  }

  remove(key: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }

    destroyBucketRenderedTileHandle(this.root, handle);
    this.renderedTileHandles.delete(key);
    this.removeKeySnapshot(key);
    this.metrics.removeCount += 1;
    this.reconcileSymbolPlacements();
    return true;
  }

  clear(): void {
    this.metrics.removeCount += this.renderedTileHandles.size;
    for (const handle of this.renderedTileHandles.values()) {
      destroyBucketRenderedTileHandle(this.root, handle);
    }
    this.renderedTileHandles.clear();
    this.allKeys.clear();
    this.visibleKeys.clear();
    this.keysBySourceId.clear();
    this.allKeySnapshot.length = 0;
    this.visibleKeySnapshot.length = 0;
    this.keysBySourceIdSnapshot.clear();
    this.coordinateByKey.clear();
    this.reconcileSymbolPlacements();
  }

  destroy(): void {
    this.clear();
  }

  private reconcileSymbolPlacements(): void {
    const symbolPlacements: SymbolPlacementTarget[] = [];
    for (const key of this.visibleKeys) {
      const handle = this.renderedTileHandles.get(key);
      if (!handle?.symbols?.placements.length) {
        continue;
      }

      const coordinate = this.coordinateByKey.get(key)
        ?? parseRenderTileCoordinateFromKey(key);
      for (const placement of handle.symbols.placements) {
        for (const [partIndex, part] of placement.collisionParts.entries()) {
          symbolPlacements.push({
            coordinate,
            handle,
            part,
            partIndex,
            placement,
          });
        }
      }
    }

    if (symbolPlacements.length === 0) {
      return;
    }

    symbolPlacements.sort(compareSymbolPlacementTargets);

    if (this.crossSourceCollisions) {
      this.reconcileSymbolPlacementsForTargets(symbolPlacements);
      this.syncVisibleSymbolSourceIndexes();
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

    this.syncVisibleSymbolSourceIndexes();
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

  private syncVisibleSymbolSourceIndexes(): void {
    for (const handle of this.renderedTileHandles.values()) {
      const symbols = handle.symbols;
      if (!symbols) {
        continue;
      }

      if (!handle.visible) {
        symbols.visibleSourceIndexesByLayerAndSourceLayer = undefined;
        continue;
      }

      const visibleSourceIndexesByLayerAndSourceLayer = new Map<string, Map<string, Set<number>>>();
      for (const placement of symbols.placements) {
        if (!placement.renderables.some(renderable => renderable.collection.get(renderable.index).show !== false)) {
          continue;
        }

        const sourceLayerKey = placement.sourceLayer ?? '';
        let sourceLayerIndexes = visibleSourceIndexesByLayerAndSourceLayer.get(placement.layerId);
        if (!sourceLayerIndexes) {
          sourceLayerIndexes = new Map<string, Set<number>>();
          visibleSourceIndexesByLayerAndSourceLayer.set(placement.layerId, sourceLayerIndexes);
        }

        let sourceIndexes = sourceLayerIndexes.get(sourceLayerKey);
        if (!sourceIndexes) {
          sourceIndexes = new Set<number>();
          sourceLayerIndexes.set(sourceLayerKey, sourceIndexes);
        }

        sourceIndexes.add(placement.sourceIndex);
      }

      symbols.visibleSourceIndexesByLayerAndSourceLayer = visibleSourceIndexesByLayerAndSourceLayer;
    }
  }

  private refreshSourceKeys(
    sourceId: string,
    getBucketTile: (key: string) => ParsedTileResult | undefined,
    style: StyleSpecification,
    styleIndex?: StyleIndex,
    sourceLayer?: string,
  ): void {
    for (const key of this.getKeysForSource(sourceId)) {
      if (sourceLayer && !this.handleMatchesSourceLayer(key, sourceLayer)) {
        continue;
      }

      const bucketTile = getBucketTile(key);
      if (!bucketTile) {
        continue;
      }

      this.refresh(key, bucketTile, style, styleIndex);
    }
  }

  private handleMatchesSourceLayer(key: string, sourceLayer: string): boolean {
    const handle = this.renderedTileHandles.get(key);
    if (!handle) {
      return false;
    }

    if (handle.sourceLayers.length === 0) {
      return true;
    }

    return handle.sourceLayers.includes(sourceLayer);
  }

  private addKeySnapshot(key: string, handle: BucketRenderedTileHandle): void {
    if (!this.allKeys.has(key)) {
      this.allKeys.add(key);
      this.allKeySnapshot.push(key);
      const coordinate = {
        ...parseRenderTileCoordinateFromKey(key),
        rawKey: stripRenderTileScope(key),
      };
      this.coordinateByKey.set(key, coordinate);

      const sourceKeys = this.keysBySourceId.get(coordinate.sourceId);
      if (sourceKeys) {
        sourceKeys.add(key);
      }
      else {
        this.keysBySourceId.set(coordinate.sourceId, new Set([key]));
      }

      const sourceKeySnapshot = this.keysBySourceIdSnapshot.get(coordinate.sourceId);
      if (sourceKeySnapshot) {
        sourceKeySnapshot.push(key);
      }
      else {
        this.keysBySourceIdSnapshot.set(coordinate.sourceId, [key]);
      }
    }

    this.updateVisibilitySnapshot(key, handle.visible);
  }

  private updateVisibilitySnapshot(key: string, visible: boolean): void {
    if (visible) {
      if (this.visibleKeys.has(key)) {
        return;
      }

      this.visibleKeys.add(key);
      this.visibleKeySnapshot.push(key);
      return;
    }

    if (!this.visibleKeys.delete(key)) {
      return;
    }

    removeKeyFromSnapshot(this.visibleKeySnapshot, key);
  }

  private removeKeySnapshot(key: string): void {
    this.updateVisibilitySnapshot(key, false);
    if (!this.allKeys.delete(key)) {
      return;
    }

    removeKeyFromSnapshot(this.allKeySnapshot, key);

    const coordinate = this.coordinateByKey.get(key);
    if (!coordinate) {
      return;
    }

    this.coordinateByKey.delete(key);
    const sourceKeys = this.keysBySourceId.get(coordinate.sourceId);
    if (!sourceKeys) {
      return;
    }

    sourceKeys.delete(key);
    if (sourceKeys.size === 0) {
      this.keysBySourceId.delete(coordinate.sourceId);
      const sourceKeySnapshot = this.keysBySourceIdSnapshot.get(coordinate.sourceId);
      if (sourceKeySnapshot) {
        removeKeyFromSnapshot(sourceKeySnapshot, key);
      }
      this.keysBySourceIdSnapshot.delete(coordinate.sourceId);
      return;
    }

    const sourceKeySnapshot = this.keysBySourceIdSnapshot.get(coordinate.sourceId);
    if (!sourceKeySnapshot) {
      return;
    }

    removeKeyFromSnapshot(sourceKeySnapshot, key);
  }
}

function removeKeyFromSnapshot(snapshot: string[], key: string): void {
  const index = snapshot.indexOf(key);
  if (index === -1) {
    return;
  }

  snapshot.splice(index, 1);
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

  if (left.handle.key < right.handle.key) {
    return -1;
  }

  if (left.handle.key > right.handle.key) {
    return 1;
  }

  return 0;
}
