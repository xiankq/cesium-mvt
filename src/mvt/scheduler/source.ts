import {
  Cartesian2,
  Cartographic,
  Rectangle,
  type Scene,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedTileRecord,
  MvtSourceOptions,
  MvtViewportListener,
  MvtViewportSnapshot,
  TileCoord,
  TileDecodeEvent,
} from '../types'
import type { TileScheduler } from './scheduler'
import { estimateSceneZoom } from '../render/geometry'

export type CesiumMvtSourceCacheOptions = {
  scene: Scene
  scheduler: TileScheduler
  tilingScheme: TilingScheme
  source: MvtSourceOptions
  autoUpdate?: boolean
  tilePadding?: number
  transitionHoldMs?: number
}

type TileDemandRecord = {
  coord: TileCoord
  lastTouchedAt: number
  ancestors: string[]
}

function toTileId(sourceId: string, tile: TileCoord): string {
  return `${sourceId}:${tile.level}/${tile.x}/${tile.y}`
}

function collectAncestorCoords(
  tile: TileCoord,
  minimumLevel: number,
): TileCoord[] {
  const ancestors: TileCoord[] = []
  let x = tile.x
  let y = tile.y

  for (let level = tile.level - 1; level >= minimumLevel; level -= 1) {
    x = Math.floor(x / 2)
    y = Math.floor(y / 2)
    ancestors.push({ x, y, level })
  }

  return ancestors
}

function collectAncestorIds(
  sourceId: string,
  tile: TileCoord,
  minimumLevel: number,
): string[] {
  return collectAncestorCoords(tile, minimumLevel).map((ancestor) =>
    toTileId(sourceId, ancestor),
  )
}

type TileIndex = {
  x: number
  y: number
}

const scratchViewRectangle = new Rectangle()
const scratchClippedRectangle = new Rectangle()
const scratchSourceRectangle = new Rectangle()
const scratchSouthwest = new Cartographic()
const scratchNorthwest = new Cartographic()
const scratchNortheast = new Cartographic()
const scratchSoutheast = new Cartographic()
const scratchTileXY = new Cartesian2()

function wrapTileX(x: number, tileCount: number): number {
  return ((x % tileCount) + tileCount) % tileCount
}

function clampTileY(y: number, tileCount: number): number {
  return Math.max(0, Math.min(tileCount - 1, y))
}

function resolveTileIndex(
  tilingScheme: TilingScheme,
  position: Cartographic,
  level: number,
): TileIndex | undefined {
  const tile = tilingScheme.positionToTileXY(position, level, scratchTileXY)
  if (!tile) {
    return undefined
  }

  return {
    x: tile.x,
    y: tile.y,
  }
}

function addTileRange(
  tileIds: Set<string>,
  sourceId: string,
  level: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  xTileCount: number,
  yTileCount: number,
): void {
  const clampedMinY = clampTileY(minY, yTileCount)
  const clampedMaxY = clampTileY(maxY, yTileCount)
  if (clampedMinY > clampedMaxY) {
    return
  }

  if (maxX - minX + 1 >= xTileCount) {
    for (let y = clampedMinY; y <= clampedMaxY; y += 1) {
      for (let x = 0; x < xTileCount; x += 1) {
        tileIds.add(toTileId(sourceId, { x, y, level }))
      }
    }
    return
  }

  for (let y = clampedMinY; y <= clampedMaxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      tileIds.add(
        toTileId(sourceId, {
          x: wrapTileX(x, xTileCount),
          y,
          level,
        }),
      )
    }
  }
}

function addRectangleTileIds(
  tileIds: Set<string>,
  sourceId: string,
  tilingScheme: TilingScheme,
  rectangle: Rectangle,
  level: number,
  tilePadding: number,
): void {
  const tileCorners = [
    resolveTileIndex(
      tilingScheme,
      Rectangle.southwest(rectangle, scratchSouthwest),
      level,
    ),
    resolveTileIndex(
      tilingScheme,
      Rectangle.northwest(rectangle, scratchNorthwest),
      level,
    ),
    resolveTileIndex(
      tilingScheme,
      Rectangle.northeast(rectangle, scratchNortheast),
      level,
    ),
    resolveTileIndex(
      tilingScheme,
      Rectangle.southeast(rectangle, scratchSoutheast),
      level,
    ),
  ].filter((tile): tile is TileIndex => tile !== undefined)

  if (tileCorners.length === 0) {
    return
  }

  const minX = Math.min(...tileCorners.map((tile) => tile.x)) - tilePadding
  const maxX = Math.max(...tileCorners.map((tile) => tile.x)) + tilePadding
  const minY = Math.min(...tileCorners.map((tile) => tile.y)) - tilePadding
  const maxY = Math.max(...tileCorners.map((tile) => tile.y)) + tilePadding

  addTileRange(
    tileIds,
    sourceId,
    level,
    minX,
    maxX,
    minY,
    maxY,
    tilingScheme.getNumberOfXTilesAtLevel(level),
    tilingScheme.getNumberOfYTilesAtLevel(level),
  )
}

export class CesiumMvtSourceCache {
  private readonly scene: Scene
  private readonly scheduler: TileScheduler
  private readonly tilingScheme: TilingScheme
  private readonly source: MvtSourceOptions
  private readonly listeners = new Set<MvtViewportListener>()
  private readonly demandedTiles = new Map<string, TileDemandRecord>()
  private readonly decodedFallbackUntil = new Map<string, number>()
  private readonly activeTileIds = new Set<string>()
  private readonly pinnedTileIds = new Set<string>()
  private readonly transitionHoldMs: number
  private readonly autoUpdate: boolean
  private readonly tilePadding: number
  private removeTileListener?: () => void
  private sweepTimer?: ReturnType<typeof setTimeout>
  private snapshot: MvtViewportSnapshot
  private paused = false
  private destroyed = false
  private latestTileLevel: number
  private latestZoom: number

  constructor(options: CesiumMvtSourceCacheOptions) {
    this.scene = options.scene
    this.scheduler = options.scheduler
    this.tilingScheme = options.tilingScheme
    this.source = options.source
    this.transitionHoldMs = options.transitionHoldMs ?? 640
    this.autoUpdate = options.autoUpdate ?? true
    this.tilePadding = Math.max(0, Math.floor(options.tilePadding ?? 1))
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

    this.removeTileListener = this.scheduler.subscribeTiles(this.handleTileEvent)

    if (this.autoUpdate) {
      this.attach()
    }
  }

  attach(): void {
    if (this.destroyed) {
      return
    }

    this.scheduleSweep()
  }

  pause(): void {
    this.paused = true
    this.clearSweepTimer()
  }

  resume(): void {
    if (!this.paused) {
      return
    }

    this.paused = false
    this.update()
  }

  reload(): void {
    this.update()
  }

  touch(tile: TileCoord): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot
    }

    const now = Date.now()
    const tileId = toTileId(this.source.id, tile)
    const record = this.demandedTiles.get(tileId)

    if (record) {
      record.lastTouchedAt = now
    } else {
      this.demandedTiles.set(tileId, {
        coord: tile,
        lastTouchedAt: now,
        ancestors: collectAncestorIds(
          this.source.id,
          tile,
          this.source.minimumLevel ?? 0,
        ),
      })
    }

    this.updateLatestViewState(tile.level)
    const snapshot = this.rebuildState(now)
    this.scheduleSweep(now)
    return snapshot
  }

  update(): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot
    }

    this.updateLatestViewState()
    const snapshot = this.rebuildState(Date.now())
    this.scheduleSweep()
    return snapshot
  }

  clearTiles(): void {
    if (this.destroyed) {
      return
    }

    const exitedTileIds = Array.from(this.activeTileIds)

    this.demandedTiles.clear()
    this.decodedFallbackUntil.clear()
    this.activeTileIds.clear()
    this.pinnedTileIds.clear()
    this.clearSweepTimer()

    for (const tileId of exitedTileIds) {
      this.scheduler.cancel(tileId)
      this.scheduler.unpin(tileId)
    }

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
    this.removeTileListener?.()
    this.removeTileListener = undefined
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

  private handleTileEvent = (event: TileDecodeEvent): void => {
    if (this.destroyed || this.paused) {
      return
    }

    if (event.type === 'evicted') {
      this.handleEvictedTile(event.tileId)
      return
    }

    if (event.type !== 'decoded') {
      return
    }

    if (!this.isVisible(event.tile.id)) {
      return
    }

    const now = Date.now()
    this.updateLatestViewState()

    for (const ancestorId of collectAncestorIds(
      this.source.id,
      event.tile.coord,
      this.source.minimumLevel ?? 0,
    )) {
      const expiry = now + this.transitionHoldMs
      const currentExpiry = this.decodedFallbackUntil.get(ancestorId)
      if (currentExpiry === undefined || expiry > currentExpiry) {
        this.decodedFallbackUntil.set(ancestorId, expiry)
      }
    }

    this.rebuildState(now)
    this.scheduleSweep(now)
  }

  private rebuildState(now: number): MvtViewportSnapshot | undefined {
    const previousSnapshot = this.snapshot
    const previousActive = new Set(this.activeTileIds)
    const previousPinned = new Set(this.pinnedTileIds)
    const nextDemanded = new Map<string, TileDemandRecord>()
    const nextFallbackUntil = new Map<string, number>()
    const nextActive = new Set<string>()
    const nextPinned = new Set<string>()
    const enteredTileIds: string[] = []
    const exitedTileIds: string[] = []

    const nextLevel = this.latestTileLevel
    const nextZoom = this.latestZoom
    const viewportTileIds = this.collectViewportTileIds(nextLevel)
    const shouldFilterCurrentLevelByViewport =
      viewportTileIds !== undefined && viewportTileIds.size > 0

    for (const [tileId, record] of this.demandedTiles) {
      const expiry = record.lastTouchedAt + this.transitionHoldMs
      const isCurrentLevel = record.coord.level === nextLevel
      const isViewportTile =
        isCurrentLevel && (
          !shouldFilterCurrentLevelByViewport ||
          viewportTileIds?.has(tileId) === true
        )

      if (isCurrentLevel && !isViewportTile) {
        continue
      }

      if (!isCurrentLevel && expiry <= now) {
        continue
      }

      nextActive.add(tileId)
      nextDemanded.set(tileId, record)

      nextPinned.add(tileId)
      const keepAncestors =
        isViewportTile &&
        (expiry > now || this.scheduler.getTile(tileId) === undefined)
      if (keepAncestors) {
        for (const ancestorId of record.ancestors) {
          const currentExpiry = nextFallbackUntil.get(ancestorId)
          if (currentExpiry === undefined || expiry > currentExpiry) {
            nextFallbackUntil.set(ancestorId, expiry)
          }
        }
      }
    }

    for (const [tileId, expiry] of this.decodedFallbackUntil) {
      if (expiry <= now) {
        continue
      }

      const currentExpiry = nextFallbackUntil.get(tileId)
      if (currentExpiry === undefined || expiry > currentExpiry) {
        nextFallbackUntil.set(tileId, expiry)
      }
    }

    for (const [tileId, expiry] of nextFallbackUntil) {
      if (expiry <= now) {
        continue
      }

      nextActive.add(tileId)
      nextPinned.add(tileId)
    }

    this.demandedTiles.clear()
    for (const [tileId, record] of nextDemanded) {
      this.demandedTiles.set(tileId, record)
    }

    this.decodedFallbackUntil.clear()
    for (const [tileId, expiry] of nextFallbackUntil) {
      if (expiry > now) {
        this.decodedFallbackUntil.set(tileId, expiry)
      }
    }

    for (const tileId of previousPinned) {
      if (!nextPinned.has(tileId)) {
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
        this.scheduler.cancel(tileId)
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
      this.scheduler.getTile(tileId)
    }
    this.pinnedTileIds.clear()
    for (const tileId of nextPinned) {
      this.pinnedTileIds.add(tileId)
    }

    const nextSnapshot: MvtViewportSnapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: nextZoom,
      level: nextLevel,
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

    return this.snapshot
  }

  private handleEvictedTile(tileId: string): void {
    const hadActive = this.activeTileIds.delete(tileId)
    this.demandedTiles.delete(tileId)
    this.decodedFallbackUntil.delete(tileId)

    const wasPinned = this.pinnedTileIds.delete(tileId)
    if (wasPinned) {
      this.scheduler.unpin(tileId)
    }

    if (hadActive || wasPinned) {
      this.snapshot = {
        sourceId: this.source.id,
        rectangle: this.snapshot.rectangle,
        zoom: this.latestZoom,
        level: this.latestTileLevel,
        activeTileIds: Array.from(this.activeTileIds),
        enteredTileIds: [],
        exitedTileIds: [tileId],
      }
      this.emit()
      this.scene.requestRender()
    }
  }

  private scheduleSweep(now = Date.now()): void {
    if (!this.autoUpdate || this.destroyed || this.paused) {
      return
    }

    let nextExpiry = Number.POSITIVE_INFINITY

    for (const record of this.demandedTiles.values()) {
      const expiry = record.lastTouchedAt + this.transitionHoldMs
      if (expiry > now && expiry < nextExpiry) {
        nextExpiry = expiry
      }
    }

    for (const expiry of this.decodedFallbackUntil.values()) {
      if (expiry < nextExpiry) {
        nextExpiry = expiry
      }
    }

    this.clearSweepTimer()

    if (!Number.isFinite(nextExpiry)) {
      return
    }

    const delay = Math.max(0, nextExpiry - now)
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined
      if (!this.destroyed && !this.paused) {
        this.rebuildState(Date.now())
        this.scheduleSweep()
      }
    }, delay)
  }

  private clearSweepTimer(): void {
    if (this.sweepTimer !== undefined) {
      clearTimeout(this.sweepTimer)
      this.sweepTimer = undefined
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }

  private updateLatestViewState(tileLevel = this.latestTileLevel): void {
    this.latestTileLevel = Math.max(
      this.source.minimumLevel ?? 0,
      tileLevel,
    )
    this.latestZoom = Math.max(
      0,
      estimateSceneZoom(this.scene) ?? this.latestTileLevel,
    )
  }

  private collectViewportTileIds(level: number): Set<string> | undefined {
    const viewRectangle = this.scene.camera.computeViewRectangle(
      this.scene.globe?.ellipsoid,
      scratchViewRectangle,
    )
    if (!viewRectangle) {
      return undefined
    }

    let clippedRectangle = Rectangle.intersection(
      viewRectangle,
      this.tilingScheme.rectangle,
      scratchClippedRectangle,
    )
    if (!clippedRectangle) {
      return new Set()
    }

    if (this.source.rectangle) {
      clippedRectangle = Rectangle.intersection(
        clippedRectangle,
        this.source.rectangle,
        scratchSourceRectangle,
      )
      if (!clippedRectangle) {
        return new Set()
      }
    }

    const tileIds = new Set<string>()
    if (clippedRectangle.west <= clippedRectangle.east) {
      addRectangleTileIds(
        tileIds,
        this.source.id,
        this.tilingScheme,
        clippedRectangle,
        level,
        this.tilePadding,
      )
      return tileIds
    }

    addRectangleTileIds(
      tileIds,
      this.source.id,
      this.tilingScheme,
      new Rectangle(
        clippedRectangle.west,
        clippedRectangle.south,
        Math.PI,
        clippedRectangle.north,
      ),
      level,
      this.tilePadding,
    )
    addRectangleTileIds(
      tileIds,
      this.source.id,
      this.tilingScheme,
      new Rectangle(
        -Math.PI,
        clippedRectangle.south,
        clippedRectangle.east,
        clippedRectangle.north,
      ),
      level,
      this.tilePadding,
    )
    return tileIds
  }
}
