import {
  Cartesian2,
  Cartographic,
  Rectangle,
  type Scene,
  type TilingScheme,
} from 'cesium'
import { createTileDecodeJob } from './tile-job'
import type {
  DecodedTileRecord,
  MvtSourceOptions,
  MvtViewportListener,
  MvtViewportSnapshot,
  TileCoord,
} from './types'
import type { TileScheduler } from './tile-scheduler'

export type CesiumMvtSourceCacheOptions = {
  scene: Scene
  scheduler: TileScheduler
  tilingScheme: TilingScheme
  source: MvtSourceOptions
  autoUpdate?: boolean
  tilePadding?: number
  transitionHoldMs?: number
}

const scratchRectangle = new Rectangle()
const scratchRectanglePoints = [
  new Cartographic(),
  new Cartographic(),
  new Cartographic(),
  new Cartographic(),
  new Cartographic(),
]

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function normalizeTileIndex(index: number, length: number): number {
  const normalized = index % length
  return normalized < 0 ? normalized + length : normalized
}

function unwrapTileIndex(index: number, center: number, length: number): number {
  const half = length / 2
  if (index - center > half) return index - length
  if (center - index > half) return index + length
  return index
}

function collectRectangleSamples(rectangle: Rectangle): Cartographic[] {
  Rectangle.southwest(rectangle, scratchRectanglePoints[0])
  Rectangle.northwest(rectangle, scratchRectanglePoints[1])
  Rectangle.northeast(rectangle, scratchRectanglePoints[2])
  Rectangle.southeast(rectangle, scratchRectanglePoints[3])
  Rectangle.center(rectangle, scratchRectanglePoints[4])
  return scratchRectanglePoints
}

function toTileXY(
  tilingScheme: TilingScheme,
  position: Cartographic,
  level: number,
): Cartesian2 | undefined {
  try {
    return tilingScheme.positionToTileXY(position, level, new Cartesian2())
  } catch {
    return undefined
  }
}

export class CesiumMvtSourceCache {
  private readonly scene: Scene
  private readonly scheduler: TileScheduler
  private readonly tilingScheme: TilingScheme
  private readonly source: MvtSourceOptions
  private readonly listeners = new Set<MvtViewportListener>()
  private readonly activeTileIds = new Set<string>()
  private readonly pendingExitSince = new Map<string, number>()
  private readonly tilePadding: number
  private readonly transitionHoldMs: number
  private removePreRender?: () => void
  private snapshot: MvtViewportSnapshot | undefined
  private paused = false
  private destroyed = false

  constructor(options: CesiumMvtSourceCacheOptions) {
    this.scene = options.scene
    this.scheduler = options.scheduler
    this.tilingScheme = options.tilingScheme
    this.source = options.source
    this.tilePadding = options.tilePadding ?? 1
    this.transitionHoldMs = options.transitionHoldMs ?? 240

    if (options.autoUpdate ?? true) {
      this.attach()
    }
  }

  attach(): void {
    if (this.destroyed || this.removePreRender) {
      return
    }

    this.removePreRender = this.scene.preRender.addEventListener(() => {
      this.update()
    })

    this.update(true)
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.update(true)
  }

  reload(): void {
    this.update(true)
  }

  update(force = false): MvtViewportSnapshot | undefined {
    if (this.destroyed || this.paused) {
      return this.snapshot
    }

    const rectangle = this.computeViewportRectangle()
    if (!rectangle) {
      return this.snapshot
    }

    const level = this.deriveLevel(rectangle)
    const nextTileCoords = this.collectVisibleTileCoords(rectangle, level)
    if (nextTileCoords.length === 0) {
      return this.snapshot
    }
    const nextTileIds = nextTileCoords.map((tile) => this.toTileId(tile))

    const nextSet = new Set(nextTileIds)
    const now = Date.now()
    const renderedBefore = new Set(this.activeTileIds)
    const enteredTileIds: string[] = []
    const exitedCandidates: string[] = []

    for (const tileId of nextTileIds) {
      if (!renderedBefore.has(tileId)) {
        enteredTileIds.push(tileId)
      }
      this.pendingExitSince.delete(tileId)
    }

    for (const tileId of renderedBefore) {
      if (!nextSet.has(tileId)) {
        exitedCandidates.push(tileId)
        if (!this.pendingExitSince.has(tileId)) {
          this.pendingExitSince.set(tileId, now)
        }
      }
    }

    for (const tile of nextTileCoords) {
      this.scheduler.schedule(
        createTileDecodeJob(this.source, this.tilingScheme, tile),
      )
    }

    if (!force && enteredTileIds.length === 0 && exitedCandidates.length === 0) {
      for (const tileId of nextTileIds) {
        this.scheduler.getTile(tileId)
      }
      this.activeTileIds.clear()
      for (const tileId of renderedBefore) {
        this.activeTileIds.add(tileId)
      }
      for (const tileId of nextTileIds) {
        this.activeTileIds.add(tileId)
      }
      return this.snapshot
    }

    const oldestPendingExitAge = this.pendingExitSince.size > 0
      ? Math.max(
          ...Array.from(this.pendingExitSince.values(), (since) => now - since),
        )
      : 0
    const nextTilesReady = nextTileIds.every((tileId) => this.scheduler.getTile(tileId) !== undefined)
    const commitPendingExits =
      force ||
      (this.pendingExitSince.size > 0 &&
        nextTilesReady &&
        oldestPendingExitAge >= this.transitionHoldMs)

    const exitedTileIds = commitPendingExits
      ? Array.from(this.pendingExitSince.keys())
      : []

    if (commitPendingExits) {
      for (const tileId of exitedTileIds) {
        this.scheduler.cancel(tileId)
      }
      this.pendingExitSince.clear()
      this.activeTileIds.clear()
      for (const tileId of nextTileIds) {
        this.activeTileIds.add(tileId)
      }
    } else {
      this.activeTileIds.clear()
      for (const tileId of renderedBefore) {
        this.activeTileIds.add(tileId)
      }
      for (const tileId of nextTileIds) {
        this.activeTileIds.add(tileId)
      }
    }

    for (const tileId of this.activeTileIds) {
      this.scheduler.getTile(tileId)
    }

    this.snapshot = {
      sourceId: this.source.id,
      rectangle: Rectangle.clone(rectangle),
      zoom: this.estimateZoom(rectangle),
      level,
      activeTileIds: Array.from(this.activeTileIds),
      enteredTileIds,
      exitedTileIds,
    }

    this.emit()

    if (enteredTileIds.length > 0 || exitedTileIds.length > 0) {
      this.scene.requestRender()
    }

    return this.snapshot
  }

  clearTiles(): void {
    if (this.destroyed) return

    for (const tileId of this.activeTileIds) {
      this.scheduler.cancel(tileId)
    }

    this.pendingExitSince.clear()

    const exitedTileIds = Array.from(this.activeTileIds)
    this.activeTileIds.clear()

    this.snapshot = {
      sourceId: this.source.id,
      rectangle: this.snapshot?.rectangle ? Rectangle.clone(this.snapshot.rectangle) : undefined,
      zoom: this.snapshot?.zoom ?? 0,
      level: this.snapshot?.level ?? this.source.minimumLevel ?? 0,
      activeTileIds: [],
      enteredTileIds: [],
      exitedTileIds,
    }

    this.emit()
    this.scene.requestRender()
  }

  remove(): void {
    if (this.destroyed) return

    this.clearTiles()
    this.removePreRender?.()
    this.removePreRender = undefined
    this.listeners.clear()
    this.destroyed = true
  }

  destroy(): void {
    this.remove()
  }

  subscribe(listener: MvtViewportListener): () => void {
    this.listeners.add(listener)
    if (this.snapshot) {
      listener(this.snapshot)
    }

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

  private computeViewportRectangle(): Rectangle | undefined {
    const rectangle = this.scene.camera.computeViewRectangle(this.tilingScheme.ellipsoid)
    if (!rectangle) {
      return this.snapshot?.rectangle
    }

    const sourceRectangle = this.source.rectangle ?? this.tilingScheme.rectangle
    return Rectangle.intersection(rectangle, sourceRectangle, scratchRectangle)
  }

  private estimateZoom(rectangle: Rectangle): number {
    const sourceRectangle = this.source.rectangle ?? this.tilingScheme.rectangle
    const minimumLevel = this.source.minimumLevel ?? 0
    const maximumLevel = this.source.maximumLevel ?? 23

    const horizontal = sourceRectangle.width / Math.max(rectangle.width, 1e-12)
    const vertical = sourceRectangle.height / Math.max(rectangle.height, 1e-12)
    const baseX = this.tilingScheme.getNumberOfXTilesAtLevel(0)
    const baseY = this.tilingScheme.getNumberOfYTilesAtLevel(0)
    const zoomEstimate = Math.max(
      Math.log2(horizontal / baseX),
      Math.log2(vertical / baseY),
    )

    return clamp(zoomEstimate, minimumLevel, maximumLevel)
  }

  private deriveLevel(rectangle: Rectangle): number {
    return Math.round(this.estimateZoom(rectangle))
  }

  private collectVisibleTileCoords(rectangle: Rectangle, level: number): TileCoord[] {
    const xCount = this.tilingScheme.getNumberOfXTilesAtLevel(level)
    const yCount = this.tilingScheme.getNumberOfYTilesAtLevel(level)
    const samples = collectRectangleSamples(rectangle)
    const tileSamples = samples
      .map((sample) => toTileXY(this.tilingScheme, sample, level))
      .filter((sample): sample is Cartesian2 => sample !== undefined)

    if (tileSamples.length === 0) {
      return []
    }

    const centerTile = tileSamples[Math.floor(tileSamples.length / 2)]
    const unwrappedX = tileSamples.map((sample) =>
      unwrapTileIndex(sample.x, centerTile.x, xCount),
    )
    const yValues = tileSamples.map((sample) => sample.y)

    let minX = Math.floor(Math.min(...unwrappedX)) - this.tilePadding
    let maxX = Math.ceil(Math.max(...unwrappedX)) + this.tilePadding
    let minY = Math.floor(Math.min(...yValues)) - this.tilePadding
    let maxY = Math.ceil(Math.max(...yValues)) + this.tilePadding

    if (maxX - minX + 1 >= xCount) {
      minX = 0
      maxX = xCount - 1
    }

    minY = clamp(minY, 0, yCount - 1)
    maxY = clamp(maxY, 0, yCount - 1)

    const coords: TileCoord[] = []
    const seen = new Set<string>()

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const normalizedX = normalizeTileIndex(x, xCount)
        const tile: TileCoord = {
          x: normalizedX,
          y,
          level,
        }
        const id = this.toTileId(tile)
        if (seen.has(id)) continue
        seen.add(id)
        coords.push(tile)
      }
    }

    return coords
  }

  private toTileId(tile: TileCoord): string {
    return `${this.source.id}:${tile.level}/${tile.x}/${tile.y}`
  }

  private emit(): void {
    if (!this.snapshot) return

    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }
}
