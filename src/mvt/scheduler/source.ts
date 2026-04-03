import type {
  ImageryLayer,
  Scene,
  TilingScheme,
} from 'cesium'
import type {
  DecodedTileRecord,
  MvtSourceOptions,
  MvtViewportListener,
  MvtViewportSnapshot,
  TileCoord,
} from '../types'
import type { TileScheduler } from './scheduler'
import { estimateSceneZoom } from '../render/geometry'

export type CesiumMvtSourceCacheOptions = {
  scene: Scene
  scheduler: TileScheduler
  tilingScheme: TilingScheme
  source: MvtSourceOptions
  imageryLayer: ImageryLayer
  autoUpdate?: boolean
  tilePadding?: number
  transitionHoldMs?: number
}

type RequestedTileRecord = {
  coord: TileCoord
}

type CesiumImageryRecord = {
  imageryLayer?: ImageryLayer
  x: number
  y: number
  level: number
}

type CesiumTileImageryRecord = {
  readyImagery?: CesiumImageryRecord
  loadingImagery?: CesiumImageryRecord
}

type CesiumSurfaceTileRecord = {
  data?: {
    imagery?: CesiumTileImageryRecord[]
  }
}

type SceneTileState = {
  desiredTiles: Map<string, TileCoord>
  visibleTiles: Map<string, TileCoord>
}

function toTileId(sourceId: string, tile: TileCoord): string {
  return `${sourceId}:${tile.level}/${tile.x}/${tile.y}`
}

function resolveTileLevel(
  tiles: Iterable<TileCoord>,
  fallback: number,
): number {
  let resolvedLevel = fallback

  for (const tile of tiles) {
    resolvedLevel = Math.max(resolvedLevel, tile.level)
  }

  return resolvedLevel
}

function toImageryCoord(imagery: CesiumImageryRecord): TileCoord {
  return {
    x: imagery.x,
    y: imagery.y,
    level: imagery.level,
  }
}

function selectDesiredImagery(
  readyImagery: CesiumImageryRecord | undefined,
  loadingImagery: CesiumImageryRecord | undefined,
): CesiumImageryRecord | undefined {
  if (!readyImagery) {
    return loadingImagery
  }

  if (!loadingImagery) {
    return readyImagery
  }

  return loadingImagery.level >= readyImagery.level
    ? loadingImagery
    : readyImagery
}

export class CesiumMvtSourceCache {
  private readonly scene: Scene
  private readonly scheduler: TileScheduler
  private readonly source: MvtSourceOptions
  private readonly imageryLayer: ImageryLayer
  private readonly listeners = new Set<MvtViewportListener>()
  private readonly activeTileIds = new Set<string>()
  private readonly pinnedTileIds = new Set<string>()
  private readonly pendingRequestedTiles = new Map<string, RequestedTileRecord>()
  private removePostRenderListener?: () => void
  private snapshot: MvtViewportSnapshot
  private paused = false
  private destroyed = false
  private readonly autoUpdate: boolean
  private latestTileLevel: number
  private latestZoom: number

  constructor(options: CesiumMvtSourceCacheOptions) {
    this.scene = options.scene
    this.scheduler = options.scheduler
    this.source = options.source
    this.imageryLayer = options.imageryLayer
    this.autoUpdate = options.autoUpdate ?? true
    this.latestTileLevel = this.source.minimumLevel ?? 0
    this.latestZoom = this.latestTileLevel
    this.snapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestZoom,
      level: this.latestTileLevel,
      activeTileIds: [],
      enteredTileIds: [],
      exitedTileIds: [],
    }

    if (this.autoUpdate) {
      this.attach()
    }
  }

  attach(): void {
    if (this.destroyed || this.removePostRenderListener) {
      return
    }

    this.removePostRenderListener = this.scene.postRender.addEventListener(
      this.handleScenePostRender,
    )
    this.syncSceneTiles()
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (!this.paused) {
      return
    }

    this.paused = false
    this.syncSceneTiles()
  }

  reload(): void {
    this.syncSceneTiles()
  }

  touch(tile: TileCoord): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot
    }

    const tileId = toTileId(this.source.id, tile)
    this.pendingRequestedTiles.set(tileId, {
      coord: tile,
    })
    this.updateLatestViewState(tile.level)
    return this.snapshot
  }

  update(): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot
    }

    this.syncSceneTiles()
    return this.snapshot
  }

  clearTiles(): void {
    if (this.destroyed) {
      return
    }

    const exitedTileIds = Array.from(this.activeTileIds)

    this.pendingRequestedTiles.clear()
    this.activeTileIds.clear()

    for (const tileId of this.pinnedTileIds) {
      this.scheduler.cancel(tileId)
      this.scheduler.unpin(tileId)
    }
    this.pinnedTileIds.clear()

    this.snapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestZoom,
      level: this.latestTileLevel,
      activeTileIds: [],
      enteredTileIds: [],
      exitedTileIds,
    }

    this.emit()
    this.scene.requestRender()
  }

  remove(): void {
    if (this.destroyed) {
      return
    }

    this.clearTiles()
    this.removePostRenderListener?.()
    this.removePostRenderListener = undefined
    this.listeners.clear()
    this.destroyed = true
  }

  destroy(): void {
    this.remove()
  }

  subscribe(listener: MvtViewportListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)

    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): MvtViewportSnapshot | undefined {
    return this.snapshot
  }

  getIds(): string[] {
    return Array.from(this.activeTileIds)
  }

  getTile(tileId: string): DecodedTileRecord | undefined {
    return this.scheduler.getTile(tileId)
  }

  isVisible(tileId: string): boolean {
    return this.activeTileIds.has(tileId)
  }

  private handleScenePostRender = (): void => {
    if (this.destroyed || this.paused) {
      return
    }

    this.syncSceneTiles()
  }

  private syncSceneTiles(): void {
    const previousSnapshot = this.snapshot
    const previousActive = new Set(this.activeTileIds)
    const previousPinned = new Set(this.pinnedTileIds)
    const nextSceneState = this.collectSceneTiles()
    const nextActive = new Set(nextSceneState.visibleTiles.keys())
    const nextPinned = new Set([
      ...nextSceneState.desiredTiles.keys(),
      ...nextActive,
    ])
    const enteredTileIds: string[] = []
    const exitedTileIds: string[] = []

    const resolvedLevel = resolveTileLevel(
      nextSceneState.desiredTiles.values(),
      this.latestTileLevel,
    )
    this.updateLatestViewState(resolvedLevel)

    for (const tileId of previousPinned) {
      if (!nextPinned.has(tileId)) {
        this.scheduler.cancel(tileId)
        this.scheduler.unpin(tileId)
      }
    }

    for (const tileId of nextPinned) {
      if (!previousPinned.has(tileId)) {
        this.scheduler.pin(tileId)
      }
    }

    for (const tileId of previousActive) {
      if (!nextActive.has(tileId)) {
        exitedTileIds.push(tileId)
      }
    }

    for (const tileId of nextActive) {
      if (!previousActive.has(tileId)) {
        enteredTileIds.push(tileId)
      }
    }

    this.activeTileIds.clear()
    for (const tileId of nextActive) {
      this.activeTileIds.add(tileId)
    }

    this.pinnedTileIds.clear()
    for (const tileId of nextPinned) {
      this.pinnedTileIds.add(tileId)
    }

    const nextSnapshot: MvtViewportSnapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestZoom,
      level: this.latestTileLevel,
      activeTileIds: Array.from(nextActive),
      enteredTileIds,
      exitedTileIds,
    }

    const changed =
      previousSnapshot.zoom !== nextSnapshot.zoom ||
      previousSnapshot.level !== nextSnapshot.level ||
      enteredTileIds.length > 0 ||
      exitedTileIds.length > 0

    this.snapshot = nextSnapshot

    if (changed) {
      this.emit()
      this.scene.requestRender()
    }
  }

  private collectSceneTiles(): SceneTileState {
    const desiredTiles = new Map<string, TileCoord>()
    const visibleTiles = new Map<string, TileCoord>()

    for (const [tileId, record] of this.pendingRequestedTiles) {
      desiredTiles.set(tileId, record.coord)
    }

    const globe = this.scene.globe as
      | {
          _surface?: {
            _tilesToRender?: CesiumSurfaceTileRecord[]
          }
        }
      | undefined
    const renderedTiles = globe?._surface?._tilesToRender ?? []

    for (const surfaceTile of renderedTiles) {
      const tileImageryCollection = surfaceTile.data?.imagery ?? []
      for (const tileImagery of tileImageryCollection) {
        const readyImagery =
          tileImagery.readyImagery?.imageryLayer === this.imageryLayer
            ? tileImagery.readyImagery
            : undefined
        const loadingImagery =
          tileImagery.loadingImagery?.imageryLayer === this.imageryLayer
            ? tileImagery.loadingImagery
            : undefined

        const desiredImagery = selectDesiredImagery(
          readyImagery,
          loadingImagery,
        )
        if (!desiredImagery) {
          continue
        }

        const desiredCoord = toImageryCoord(desiredImagery)
        desiredTiles.set(
          toTileId(this.source.id, desiredCoord),
          desiredCoord,
        )

        const visibleCoord = this.resolveVisibleTileCoord(desiredCoord)
        if (!visibleCoord) {
          continue
        }

        visibleTiles.set(
          toTileId(this.source.id, visibleCoord),
          visibleCoord,
        )
      }
    }

    this.pendingRequestedTiles.clear()
    return {
      desiredTiles,
      visibleTiles,
    }
  }

  private updateLatestViewState(tileLevel = this.latestTileLevel): void {
    this.latestTileLevel = Math.max(
      this.source.minimumLevel ?? 0,
      tileLevel,
    )
    this.latestZoom = Math.max(
      0,
      Math.round(estimateSceneZoom(this.scene) ?? this.latestTileLevel),
    )
  }

  private resolveVisibleTileCoord(coord: TileCoord): TileCoord | undefined {
    const minimumLevel = this.source.minimumLevel ?? 0
    let current = coord

    for (let level = coord.level; level >= minimumLevel; level -= 1) {
      const tileId = toTileId(this.source.id, current)
      if (this.scheduler.getTile(tileId)) {
        return current
      }

      current = {
        x: Math.floor(current.x / 2),
        y: Math.floor(current.y / 2),
        level: level - 1,
      }
    }

    return undefined
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }
}
