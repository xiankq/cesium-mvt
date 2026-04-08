import type { ImageryLayer, Scene, TilingScheme } from 'cesium';
import type { DecodedTileRecord, MvtSourceOptions, MvtViewportListener, MvtViewportSnapshot, TileCoord } from '../types';
import type { TileScheduler } from './scheduler';
import { estimateSceneZoom } from '../render/geometry';

export interface CesiumMvtSourceCacheOptions {
  scene: Scene;
  scheduler: TileScheduler;
  tilingScheme: TilingScheme;
  source: MvtSourceOptions;
  imageryLayer: ImageryLayer;
  autoUpdate?: boolean;
  tilePadding?: number;
  transitionHoldMs?: number;
}

interface RequestedTileRecord {
  coord: TileCoord;
}

interface CesiumImageryRecord {
  imageryLayer?: ImageryLayer;
  x: number;
  y: number;
  level: number;
}

interface CesiumTileImageryRecord {
  readyImagery?: CesiumImageryRecord;
  loadingImagery?: CesiumImageryRecord;
}

interface CesiumSurfaceTileRecord {
  data?: {
    imagery?: CesiumTileImageryRecord[];
  };
}

interface SceneTileState {
  desiredTiles: Map<string, TileCoord>;
  visibleTiles: Map<string, TileCoord>;
}

const STYLE_ZOOM_STEP = 0.25;
const VIEW_SIGNATURE_POSITION_PRECISION = 0.5;
const VIEW_SIGNATURE_ANGLE_PRECISION = 1e-4;

function toTileId(sourceId: string, tile: TileCoord): string {
  return `${sourceId}:${tile.level}/${tile.x}/${tile.y}`;
}

function resolveTileLevel(
  tiles: Iterable<TileCoord>,
  fallback: number,
): number {
  let resolvedLevel = fallback;

  for (const tile of tiles) {
    resolvedLevel = Math.max(resolvedLevel, tile.level);
  }

  return resolvedLevel;
}

function toImageryCoord(imagery: CesiumImageryRecord): TileCoord {
  return {
    x: imagery.x,
    y: imagery.y,
    level: imagery.level,
  };
}

function selectDesiredImagery(
  readyImagery: CesiumImageryRecord | undefined,
  loadingImagery: CesiumImageryRecord | undefined,
): CesiumImageryRecord | undefined {
  if (!readyImagery) {
    return loadingImagery;
  }

  if (!loadingImagery) {
    return readyImagery;
  }

  return loadingImagery.level >= readyImagery.level
    ? loadingImagery
    : readyImagery;
}

function quantizeZoom(zoom: number): number {
  return Math.round(zoom / STYLE_ZOOM_STEP) * STYLE_ZOOM_STEP;
}

function quantizeViewSignatureValue(
  value: number,
  precision: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value / precision);
}

export function buildSceneViewSignature(
  scene: Pick<Scene, 'camera'>,
): string {
  const position = scene.camera.positionWC ?? scene.camera.position;

  return [
    quantizeViewSignatureValue(
      position.x,
      VIEW_SIGNATURE_POSITION_PRECISION,
    ),
    quantizeViewSignatureValue(
      position.y,
      VIEW_SIGNATURE_POSITION_PRECISION,
    ),
    quantizeViewSignatureValue(
      position.z,
      VIEW_SIGNATURE_POSITION_PRECISION,
    ),
    quantizeViewSignatureValue(
      scene.camera.heading,
      VIEW_SIGNATURE_ANGLE_PRECISION,
    ),
    quantizeViewSignatureValue(
      scene.camera.pitch,
      VIEW_SIGNATURE_ANGLE_PRECISION,
    ),
    quantizeViewSignatureValue(
      scene.camera.roll,
      VIEW_SIGNATURE_ANGLE_PRECISION,
    ),
  ].join('|');
}

export function getRenderedSurfaceTiles(
  scene: Pick<Scene, 'globe'>,
): CesiumSurfaceTileRecord[] | undefined {
  const globe = scene.globe as
    | {
      _surface?: {
        _tilesToRender?: CesiumSurfaceTileRecord[];
      };
    }
    | undefined;
  const renderedTiles = globe?._surface?._tilesToRender;
  return Array.isArray(renderedTiles) ? renderedTiles : undefined;
}

export class CesiumMvtSourceCache {
  private readonly defaultTransitionHoldMs = 180;
  private readonly scene: Scene;
  private readonly scheduler: TileScheduler;
  private readonly source: MvtSourceOptions;
  private readonly imageryLayer: ImageryLayer;
  private readonly listeners = new Set<MvtViewportListener>();
  private readonly activeTileIds = new Set<string>();
  private readonly pinnedTileIds = new Set<string>();
  private readonly pendingRequestedTiles = new Map<string, RequestedTileRecord>();
  private removePostRenderListener?: () => void;
  private snapshot: MvtViewportSnapshot;
  private paused = false;
  private destroyed = false;
  private readonly autoUpdate: boolean;
  private readonly transitionHoldMs: number;
  private latestTileLevel: number;
  private latestZoom: number;
  private pendingVisibleTileIds?: Set<string>;
  private pendingVisibleSince = 0;
  private sceneDirty = true;
  private lastViewSignature?: string;

  constructor(options: CesiumMvtSourceCacheOptions) {
    this.scene = options.scene;
    this.scheduler = options.scheduler;
    this.source = options.source;
    this.imageryLayer = options.imageryLayer;
    this.autoUpdate = options.autoUpdate ?? true;
    this.transitionHoldMs = options.transitionHoldMs ?? this.defaultTransitionHoldMs;
    this.latestTileLevel = this.source.minimumLevel ?? 0;
    this.latestZoom = this.latestTileLevel;
    this.snapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestZoom,
      level: this.latestTileLevel,
      activeTileIds: [],
      enteredTileIds: [],
      exitedTileIds: [],
    };

    if (this.autoUpdate) {
      this.attach();
    }
  }

  attach(): void {
    if (this.destroyed || this.removePostRenderListener) {
      return;
    }

    this.sceneDirty = true;
    this.removePostRenderListener = this.scene.postRender.addEventListener(
      this.handleScenePostRender,
    );
    // Kick off Cesium's render cycle immediately so imagery tiles get requested.
    // Then sync tiles after the first frame when surface tiles are available.
    this.scene.requestRender();
    this.syncAfterFirstFrame = true;
  }

  private syncAfterFirstFrame = false;

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) {
      return;
    }

    this.paused = false;
    this.sceneDirty = true;
    this.syncSceneTiles();
  }

  reload(): void {
    this.sceneDirty = true;
    this.syncSceneTiles();
  }

  touch(tile: TileCoord): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot;
    }

    const tileId = toTileId(this.source.id, tile);
    this.pendingRequestedTiles.set(tileId, {
      coord: tile,
    });
    this.updateLatestViewState(tile.level);
    this.sceneDirty = true;
    return this.snapshot;
  }

  update(): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot;
    }

    this.sceneDirty = true;
    this.syncSceneTiles();
    return this.snapshot;
  }

  clearTiles(): void {
    if (this.destroyed) {
      return;
    }

    const exitedTileIds = Array.from(this.activeTileIds);

    this.pendingRequestedTiles.clear();
    this.activeTileIds.clear();
    this.pendingVisibleTileIds = undefined;
    this.pendingVisibleSince = 0;
    this.sceneDirty = true;
    this.lastViewSignature = undefined;

    for (const tileId of this.pinnedTileIds) {
      this.scheduler.cancel(tileId);
      this.scheduler.unpin(tileId);
    }
    this.pinnedTileIds.clear();

    this.snapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestZoom,
      level: this.latestTileLevel,
      activeTileIds: [],
      enteredTileIds: [],
      exitedTileIds,
    };

    this.emit();
    this.scene.requestRender();
  }

  remove(): void {
    if (this.destroyed) {
      return;
    }

    this.clearTiles();
    this.removePostRenderListener?.();
    this.removePostRenderListener = undefined;
    this.listeners.clear();
    this.destroyed = true;
  }

  destroy(): void {
    this.remove();
  }

  subscribe(listener: MvtViewportListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): MvtViewportSnapshot | undefined {
    return this.snapshot;
  }

  getIds(): string[] {
    return Array.from(this.activeTileIds);
  }

  getTile(tileId: string): DecodedTileRecord | undefined {
    return this.scheduler.getTile(tileId);
  }

  isVisible(tileId: string): boolean {
    return this.activeTileIds.has(tileId);
  }

  hasActiveTiles(): boolean {
    return this.activeTileIds.size > 0;
  }

  private handleScenePostRender = (): void => {
    if (this.destroyed || this.paused) {
      return;
    }

    if (!this.shouldSyncSceneTiles()) {
      return;
    }

    this.syncSceneTiles();
  };

  private syncSceneTiles(): void {
    this.sceneDirty = false;
    this.lastViewSignature = buildSceneViewSignature(this.scene);

    const previousSnapshot = this.snapshot;
    const previousActive = new Set(this.activeTileIds);
    const previousPinned = new Set(this.pinnedTileIds);
    const nextSceneState = this.collectSceneTiles();
    const nextActive = this.resolveActiveTileIds(
      nextSceneState.visibleTiles,
      previousActive,
    );
    const nextPinned = new Set([
      ...nextSceneState.desiredTiles.keys(),
      ...nextActive,
    ]);
    const enteredTileIds: string[] = [];
    const exitedTileIds: string[] = [];

    const resolvedLevel = resolveTileLevel(
      nextSceneState.desiredTiles.values(),
      this.latestTileLevel,
    );
    this.updateLatestViewState(resolvedLevel);

    for (const tileId of previousPinned) {
      if (!nextPinned.has(tileId)) {
        this.scheduler.cancel(tileId);
        this.scheduler.unpin(tileId);
      }
    }

    for (const tileId of nextPinned) {
      if (!previousPinned.has(tileId)) {
        this.scheduler.pin(tileId);
      }
    }

    for (const tileId of previousActive) {
      if (!nextActive.has(tileId)) {
        exitedTileIds.push(tileId);
      }
    }

    for (const tileId of nextActive) {
      if (!previousActive.has(tileId)) {
        enteredTileIds.push(tileId);
      }
    }

    this.activeTileIds.clear();
    for (const tileId of nextActive) {
      this.activeTileIds.add(tileId);
    }

    this.pinnedTileIds.clear();
    for (const tileId of nextPinned) {
      this.pinnedTileIds.add(tileId);
    }

    const nextSnapshot: MvtViewportSnapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestZoom,
      level: this.latestTileLevel,
      activeTileIds: Array.from(nextActive),
      enteredTileIds,
      exitedTileIds,
    };

    const changed
      = previousSnapshot.zoom !== nextSnapshot.zoom
        || previousSnapshot.level !== nextSnapshot.level
        || enteredTileIds.length > 0
        || exitedTileIds.length > 0;

    this.snapshot = nextSnapshot;

    if (changed) {
      this.emit();
      this.scene.requestRender();
    }
  }

  private collectSceneTiles(): SceneTileState {
    const desiredTiles = new Map<string, TileCoord>();
    const candidateVisibleTiles = new Map<string, TileCoord>();

    for (const [tileId, record] of this.pendingRequestedTiles) {
      desiredTiles.set(tileId, record.coord);
    }

    const renderedTiles = getRenderedSurfaceTiles(this.scene);
    if (!renderedTiles) {
      this.pendingRequestedTiles.clear();
      return {
        desiredTiles,
        visibleTiles: normalizeVisibleTileCover(
          this.source.id,
          desiredTiles.values(),
          this.source.minimumLevel ?? 0,
        ),
      };
    }

    for (const surfaceTile of renderedTiles) {
      const tileImageryCollection = surfaceTile.data?.imagery ?? [];
      for (const tileImagery of tileImageryCollection) {
        const readyImagery
          = tileImagery.readyImagery?.imageryLayer === this.imageryLayer
            ? tileImagery.readyImagery
            : undefined;
        const loadingImagery
          = tileImagery.loadingImagery?.imageryLayer === this.imageryLayer
            ? tileImagery.loadingImagery
            : undefined;

        const desiredImagery = selectDesiredImagery(
          readyImagery,
          loadingImagery,
        );
        if (!desiredImagery) {
          continue;
        }

        const desiredCoord = toImageryCoord(desiredImagery);
        desiredTiles.set(
          toTileId(this.source.id, desiredCoord),
          desiredCoord,
        );

        const visibleCoord = this.resolveVisibleTileCoord(desiredCoord);
        if (!visibleCoord) {
          continue;
        }

        candidateVisibleTiles.set(
          toTileId(this.source.id, visibleCoord),
          visibleCoord,
        );
      }
    }

    this.pendingRequestedTiles.clear();
    return {
      desiredTiles,
      visibleTiles: normalizeVisibleTileCover(
        this.source.id,
        candidateVisibleTiles.values(),
        this.source.minimumLevel ?? 0,
      ),
    };
  }

  private updateLatestViewState(tileLevel = this.latestTileLevel): void {
    this.latestTileLevel = Math.max(
      this.source.minimumLevel ?? 0,
      tileLevel,
    );
    this.latestZoom = quantizeZoom(
      Math.max(
        0,
        estimateSceneZoom(this.scene) ?? this.latestTileLevel,
      ),
    );
  }

  private resolveVisibleTileCoord(coord: TileCoord): TileCoord | undefined {
    const minimumLevel = this.source.minimumLevel ?? 0;
    let current = coord;

    for (let level = coord.level; level >= minimumLevel; level -= 1) {
      const tileId = toTileId(this.source.id, current);
      if (this.scheduler.getTile(tileId)) {
        return current;
      }

      current = {
        x: Math.floor(current.x / 2),
        y: Math.floor(current.y / 2),
        level: level - 1,
      };
    }

    return undefined;
  }

  private resolveActiveTileIds(
    candidateVisibleTiles: ReadonlyMap<string, TileCoord>,
    previousActive: Set<string>,
  ): Set<string> {
    const candidateVisibleTileIds = new Set(candidateVisibleTiles.keys());
    if (
      this.transitionHoldMs <= 0
      || previousActive.size === 0
      || areTileSetsEqual(previousActive, candidateVisibleTileIds)
    ) {
      this.pendingVisibleTileIds = undefined;
      this.pendingVisibleSince = 0;
      return candidateVisibleTileIds;
    }

    const now = Date.now();
    if (
      this.pendingVisibleTileIds
      && areTileSetsEqual(this.pendingVisibleTileIds, candidateVisibleTileIds)
    ) {
      if (now - this.pendingVisibleSince >= this.transitionHoldMs) {
        this.pendingVisibleTileIds = undefined;
        this.pendingVisibleSince = 0;
        return candidateVisibleTileIds;
      }
    }
    else {
      this.pendingVisibleTileIds = new Set(candidateVisibleTileIds);
      this.pendingVisibleSince = now;
    }

    this.scene.requestRender();
    return previousActive;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private shouldSyncSceneTiles(): boolean {
    if (
      this.sceneDirty
      || this.pendingRequestedTiles.size > 0
      || this.pendingVisibleTileIds !== undefined
    ) {
      return true;
    }

    return buildSceneViewSignature(this.scene) !== this.lastViewSignature;
  }
}

function areTileSetsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const tileId of left) {
    if (!right.has(tileId)) {
      return false;
    }
  }

  return true;
}

interface TileCoverNode {
  coord: TileCoord;
  id: string;
  present: boolean;
  hasCoverage: boolean;
  fullyCovered: boolean;
  children: Array<TileCoverNode | undefined>;
}

export function normalizeVisibleTileCover(
  sourceId: string,
  tiles: Iterable<TileCoord>,
  minimumLevel: number,
): Map<string, TileCoord> {
  const nodes = new Map<string, TileCoverNode>();
  const rootIds = new Set<string>();

  const ensureNode = (coord: TileCoord): TileCoverNode => {
    const id = toTileId(sourceId, coord);
    const existing = nodes.get(id);
    if (existing) {
      return existing;
    }

    const created: TileCoverNode = {
      coord,
      id,
      present: false,
      hasCoverage: false,
      fullyCovered: false,
      children: [undefined, undefined, undefined, undefined],
    };
    nodes.set(id, created);
    rootIds.add(id);
    return created;
  };

  for (const tile of tiles) {
    let current = ensureNode(tile);
    current.present = true;

    for (let level = tile.level; level > minimumLevel; level -= 1) {
      const parentCoord: TileCoord = {
        x: Math.floor(current.coord.x / 2),
        y: Math.floor(current.coord.y / 2),
        level: current.coord.level - 1,
      };
      const parent = ensureNode(parentCoord);
      parent.children[getChildIndex(current.coord)] = current;
      rootIds.delete(current.id);
      current = parent;
    }
  }

  for (const rootId of rootIds) {
    const root = nodes.get(rootId);
    if (root) {
      computeTileCoverage(root);
    }
  }

  const normalized = new Map<string, TileCoord>();
  for (const rootId of rootIds) {
    const root = nodes.get(rootId);
    if (root) {
      collectNormalizedTileCover(root, normalized);
    }
  }

  return normalized;
}

function computeTileCoverage(node: TileCoverNode): void {
  let hasCoverage = node.present;
  let fullyCoveredByChildren = true;

  for (const child of node.children) {
    if (!child) {
      fullyCoveredByChildren = false;
      continue;
    }

    computeTileCoverage(child);
    hasCoverage = hasCoverage || child.hasCoverage;
    fullyCoveredByChildren = fullyCoveredByChildren && child.fullyCovered;
  }

  node.hasCoverage = hasCoverage;
  node.fullyCovered = node.present || fullyCoveredByChildren;
}

function collectNormalizedTileCover(
  node: TileCoverNode,
  result: Map<string, TileCoord>,
): void {
  if (!node.hasCoverage) {
    return;
  }

  const fullyCoveredByChildren = node.children.every(
    child => child?.fullyCovered === true,
  );

  if (node.present && !fullyCoveredByChildren) {
    result.set(node.id, node.coord);
    return;
  }

  for (const child of node.children) {
    if (child?.hasCoverage) {
      collectNormalizedTileCover(child, result);
    }
  }
}

function getChildIndex(coord: TileCoord): number {
  const xBit = coord.x & 1;
  const yBit = coord.y & 1;
  return yBit * 2 + xBit;
}
