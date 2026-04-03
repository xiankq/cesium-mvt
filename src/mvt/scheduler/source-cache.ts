import type { Scene } from 'cesium'
import type {
  DecodedTileRecord,
  MvtSourceOptions,
  MvtViewportListener,
  MvtViewportSnapshot,
  TileCoord,
  TileDecodeEvent,
} from '../types'
import type { TileScheduler } from './tile-scheduler'
import { estimateSceneZoom } from '../render/feature-preview-geometry'

export type CesiumMvtSourceCacheOptions = {
  scene: Scene
  scheduler: TileScheduler
  tilingScheme: import('cesium').TilingScheme
  source: MvtSourceOptions
  autoUpdate?: boolean
  tilePadding?: number
  transitionHoldMs?: number
}

type TileDemandRecord = {
  coord: TileCoord
  requestedAt: number
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

export class CesiumMvtSourceCache {
  private readonly scene: Scene
  private readonly scheduler: TileScheduler
  private readonly source: MvtSourceOptions
  private readonly listeners = new Set<MvtViewportListener>()
  private readonly demandedTiles = new Map<string, TileDemandRecord>()
  private readonly decodedFallbackUntil = new Map<string, number>()
  private readonly activeTileIds = new Set<string>()
  private readonly pinnedTileIds = new Set<string>()
  private readonly transitionHoldMs: number
  private readonly autoUpdate: boolean
  private removeTileListener?: () => void
  private sweepTimer?: ReturnType<typeof setTimeout>
  private snapshot: MvtViewportSnapshot
  private paused = false
  private destroyed = false
  private latestLevel: number

  constructor(options: CesiumMvtSourceCacheOptions) {
    this.scene = options.scene
    this.scheduler = options.scheduler
    this.source = options.source
    this.transitionHoldMs = options.transitionHoldMs ?? 640
    this.autoUpdate = options.autoUpdate ?? true
    this.latestLevel = this.source.minimumLevel ?? 0
    this.snapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestLevel,
      level: this.latestLevel,
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
        requestedAt: now,
        lastTouchedAt: now,
        ancestors: collectAncestorIds(
          this.source.id,
          tile,
          this.source.minimumLevel ?? 0,
        ),
      })
    }

    this.latestLevel = Math.max(
      0,
      Math.round(estimateSceneZoom(this.scene) ?? tile.level),
    )
    const snapshot = this.rebuildState(now)
    this.scheduleSweep(now)
    return snapshot
  }

  update(): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot
    }

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
      this.scheduler.unpin(tileId)
    }

    this.snapshot = {
      sourceId: this.source.id,
      rectangle: undefined,
      zoom: this.latestLevel,
      level: this.latestLevel,
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
    this.latestLevel = Math.max(
      0,
      Math.round(estimateSceneZoom(this.scene) ?? event.tile.coord.level),
    )

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

    const nextLevel = this.latestLevel
    const nextZoom = this.latestLevel

    for (const [tileId, record] of this.demandedTiles) {
      const expiry = record.lastTouchedAt + this.transitionHoldMs
      nextActive.add(tileId)

      nextDemanded.set(tileId, record)

      if (now < expiry) {
        nextPinned.add(tileId)
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
        zoom: this.latestLevel,
        level: this.latestLevel,
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
}
