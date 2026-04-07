import {
  Color,
  GeometryInstance,
  Material,
  type PointPrimitive,
  PointPrimitiveCollection,
  type Polyline,
  PolylineCollection,
  PerInstanceColorAppearance,
  Primitive,
  type Scene,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
  MvtSchedulerSnapshot,
  MvtViewportSnapshot,
} from '../types'
import type { TileDecodeEvent } from '../types'
import type { TileScheduler } from '../scheduler/scheduler'
import type { CesiumMvtSourceCache } from '../scheduler/source'
import type { MapLibreStyleDocument } from '../style/document'
import { MapLibreSpriteAtlas } from './sprite'
import {
  compileMapLibreStyleRenderer,
  type CompiledStyleLayer,
  type CompiledStyleRefreshMode,
  type CompiledMapLibreStyleRenderer,
} from '../style/renderer'
import {
  addPrimitiveOrdered,
  applyOpacity,
  createPolylineMaterial,
  estimateSceneZoom,
  evaluateStyleLayerSortKey,
  removeAndDestroyPrimitive,
} from './geometry'
import { renderLineStringPrimitives } from './line-string'
import type { StyledSymbolPlacement } from './label'
import { renderPointPrimitives } from './point'
import { renderPolygonPrimitives } from './polygon'
import { createStyledSymbolPlacement, SymbolRenderer } from './symbol'

export type CesiumMvtPrimitiveLayerOptions = {
  style?: MapLibreStyleDocument
  pointColor?: Color
  lineColor?: Color
  polygonFillColor?: Color
  polygonOutlineColor?: Color
  pointOutlineColor?: Color
  pointPixelSize?: number
  lineWidth?: number
  polygonOutlineWidth?: number
  showPoints?: boolean
  showLines?: boolean
  showPolygonFills?: boolean
  showPolygonOutlines?: boolean
  showLabels?: boolean
  suspendLabelsDuringCameraMove?: boolean
  suspendLabelsDuringLoading?: boolean
  labelResumeDelayMs?: number
  sourceCache?: CesiumMvtSourceCache
  layerFilter?: (layer: DecodedLayerRecord, tile: DecodedTileRecord) => boolean
  featureFilter?: (
    feature: DecodedFeatureRecord,
    layer: DecodedLayerRecord,
    tile: DecodedTileRecord,
  ) => boolean
}

type ResolvedCesiumMvtPrimitiveLayerOptions = Omit<
  CesiumMvtPrimitiveLayerOptions,
  'sourceCache' | 'style'
> & {
  style?: MapLibreStyleDocument
}

type TilePrimitiveGroup = {
  mode: 'generic' | 'styled'
  refreshState: TileZoomRefreshState
  pointCount: number
  lineCount: number
  polygonCount: number
  labelCount: number
  iconCount: number
  symbolPlacements: StyledSymbolPlacement[]
  paintBindings: StyledPaintBinding[]
  destroy: () => void
}

type StyledFeatureEntry = {
  feature: DecodedFeatureRecord
  featureIndex: number
  sortKey: number
}

type TileZoomRefreshState = {
  full: boolean
  paint: boolean
  symbols: boolean
}

type LinePaintBinding = {
  type: 'line'
  compiled: Extract<CompiledStyleLayer, { type: 'line' }>
  feature: DecodedFeatureRecord
  polyline: Polyline
}

type CirclePaintBinding = {
  type: 'circle'
  compiled: Extract<CompiledStyleLayer, { type: 'circle' }>
  feature: DecodedFeatureRecord
  pointPrimitive: PointPrimitive
}

type StyledPaintBinding = LinePaintBinding | CirclePaintBinding

const DEFAULT_POINT_COLOR = Color.fromCssColorString('#67d7ff')
const DEFAULT_LINE_COLOR = Color.fromCssColorString('#8c9eff')
const DEFAULT_POLYGON_FILL_COLOR = Color.fromCssColorString('#173b78')
DEFAULT_POLYGON_FILL_COLOR.alpha = 0.28
const DEFAULT_POLYGON_OUTLINE_COLOR = Color.fromCssColorString('#7c5cff')
const DEFAULT_POINT_OUTLINE_COLOR = Color.fromCssColorString('#06131f')

function createTileZoomRefreshState(): TileZoomRefreshState {
  return {
    full: false,
    paint: false,
    symbols: false,
  }
}

function mergeRefreshState(
  state: TileZoomRefreshState,
  refreshMode: CompiledStyleRefreshMode,
): TileZoomRefreshState {
  switch (refreshMode) {
    case 'full':
      state.full = true
      break
    case 'paint':
      state.paint = true
      break
    case 'symbols':
      state.symbols = true
      break
    default:
      break
  }

  return state
}

export class CesiumMvtPrimitiveLayer {
  private readonly scene: Scene
  private readonly scheduler: TileScheduler
  private readonly tilingScheme: TilingScheme
  private readonly options: ResolvedCesiumMvtPrimitiveLayerOptions & {
    pointColor: Color
    lineColor: Color
    polygonFillColor: Color
    polygonOutlineColor: Color
    pointOutlineColor: Color
    pointPixelSize: number
    lineWidth: number
    polygonOutlineWidth: number
    showPoints: boolean
    showLines: boolean
    showPolygonFills: boolean
    showPolygonOutlines: boolean
    showLabels: boolean
    layerFilter: (layer: DecodedLayerRecord, tile: DecodedTileRecord) => boolean
    featureFilter: (
      feature: DecodedFeatureRecord,
      layer: DecodedLayerRecord,
      tile: DecodedTileRecord,
    ) => boolean
  }
  private readonly groups = new Map<string, TilePrimitiveGroup>()
  private readonly primitiveOrderMap = new WeakMap<object, number>()
  private readonly spriteAtlas?: MapLibreSpriteAtlas
  private readonly symbolRenderer: SymbolRenderer
  private readonly sourceCache?: CesiumMvtSourceCache
  private readonly styleRenderer?: CompiledMapLibreStyleRenderer
  private readonly unsubscribeTiles: () => void
  private readonly unsubscribeScheduler?: () => void
  private readonly unsubscribeViewport?: () => void
  private removeCameraMoveStart?: () => void
  private removeCameraMoveEnd?: () => void
  private currentZoom = 0
  private labelsVisible = true
  private atlasRefreshScheduled = false
  private destroyed = false
  private cameraLabelsSuspended = false
  private loadingLabelsSuspended = false
  private labelResumeTimer?: ReturnType<typeof setTimeout>
  private readonly suspendLabelsDuringCameraMove: boolean
  private readonly suspendLabelsDuringLoading: boolean
  private readonly labelResumeDelayMs: number
  private readonly symbolRebuildDelayMs = 160
  private readonly visibleTileRefreshDelayMs = 120
  private readonly movingViewportUpdateDelayMs = 80
  private symbolRebuildTimer?: ReturnType<typeof setTimeout>
  private visibleTileRefreshTimer?: ReturnType<typeof setTimeout>
  private viewportUpdateTimer?: ReturnType<typeof setTimeout>
  private symbolLayoutDirty = false
  private symbolLayoutDirtyWhileHidden = false
  private cameraMoving = false
  private suppressedTileEventsDuringCameraMove = false
  private pendingViewportSnapshot?: MvtViewportSnapshot
  private pendingViewportRequiresTileRefresh = false

  constructor(
    scene: Scene,
    scheduler: TileScheduler,
    tilingScheme: TilingScheme,
    options: CesiumMvtPrimitiveLayerOptions = {},
  ) {
    this.scene = scene
    this.scheduler = scheduler
    this.tilingScheme = tilingScheme
    this.options = {
      style: options.style,
      pointColor: options.pointColor ?? DEFAULT_POINT_COLOR,
      lineColor: options.lineColor ?? DEFAULT_LINE_COLOR,
      polygonFillColor: options.polygonFillColor ?? DEFAULT_POLYGON_FILL_COLOR,
      polygonOutlineColor: options.polygonOutlineColor ?? DEFAULT_POLYGON_OUTLINE_COLOR,
      pointOutlineColor: options.pointOutlineColor ?? DEFAULT_POINT_OUTLINE_COLOR,
      pointPixelSize: options.pointPixelSize ?? 4,
      lineWidth: options.lineWidth ?? 2,
      polygonOutlineWidth: options.polygonOutlineWidth ?? 1.5,
      showPoints: options.showPoints ?? true,
      showLines: options.showLines ?? true,
      showPolygonFills: options.showPolygonFills ?? true,
      showPolygonOutlines: options.showPolygonOutlines ?? true,
      showLabels: options.showLabels ?? true,
      layerFilter: options.layerFilter ?? (() => true),
      featureFilter: options.featureFilter ?? (() => true),
    }
    this.suspendLabelsDuringCameraMove = options.suspendLabelsDuringCameraMove ?? false
    this.suspendLabelsDuringLoading = options.suspendLabelsDuringLoading ?? false
    this.labelResumeDelayMs = options.labelResumeDelayMs ?? 160

    this.sourceCache = options.sourceCache
    this.styleRenderer = options.style ? compileMapLibreStyleRenderer(options.style) : undefined
    this.spriteAtlas = options.style?.sprite
      ? new MapLibreSpriteAtlas(options.style.sprite)
      : undefined
    this.symbolRenderer = new SymbolRenderer(
      scene,
      this.primitiveOrderMap,
      this.spriteAtlas,
    )

    this.unsubscribeTiles = scheduler.subscribeTiles(this.handleTileEvent)
    this.unsubscribeScheduler = this.suspendLabelsDuringLoading
      ? scheduler.subscribe(this.handleSchedulerSnapshot)
      : undefined

    if (this.sourceCache) {
      this.unsubscribeViewport = this.sourceCache.subscribe(this.handleViewportEvent)
    }

    if (this.spriteAtlas) {
      void this.spriteAtlas
        .load()
        .then(() => {
          if (this.destroyed) {
            return
          }
          this.scheduleAtlasRefresh()
        })
        .catch(() => {
          // Sprite loading is best-effort; symbol rendering can continue without icons.
        })
    }

    if (this.sourceCache || (this.options.showLabels && this.suspendLabelsDuringCameraMove)) {
      this.removeCameraMoveStart = this.scene.camera.moveStart.addEventListener(() => {
        this.handleCameraMoveStateChange(true)
      })
      this.removeCameraMoveEnd = this.scene.camera.moveEnd.addEventListener(() => {
        this.handleCameraMoveStateChange(false)
      })
    }

    for (const tile of scheduler.getCachedTiles()) {
      if (this.sourceCache && !this.sourceCache.isVisible(tile.id)) {
        continue
      }
      this.addTile(tile)
    }
  }

  get tileCount(): number {
    return this.groups.size
  }

  private handleSchedulerSnapshot = (snapshot: MvtSchedulerSnapshot): void => {
    if (!this.suspendLabelsDuringLoading || !this.options.showLabels) {
      return
    }

    const busy = snapshot.queued > 0 || snapshot.inFlight > 0
    if (busy) {
      this.setLoadingLabelSuspended(true)
      return
    }

    this.setLoadingLabelSuspended(false)
  }

  private setCameraLabelSuspended(suspended: boolean): void {
    if (this.cameraLabelsSuspended === suspended) {
      return
    }

    this.cameraLabelsSuspended = suspended
    if (suspended) {
      this.clearLabelResumeTimer()
      this.refreshLabelVisibility()
      return
    }

    this.refreshLabelVisibility(true)
  }

  private setLoadingLabelSuspended(suspended: boolean): void {
    if (this.loadingLabelsSuspended === suspended) {
      return
    }

    this.loadingLabelsSuspended = suspended
    if (suspended) {
      this.clearLabelResumeTimer()
      this.refreshLabelVisibility()
      return
    }

    this.refreshLabelVisibility()
  }

  private refreshLabelVisibility(forceImmediate = false): void {
    if (!this.options.showLabels) {
      this.clearLabelResumeTimer()
      this.setLabelsVisible(false)
      return
    }

    const nextVisible =
      !this.cameraLabelsSuspended && !this.loadingLabelsSuspended

    if (!nextVisible) {
      this.clearLabelResumeTimer()
      this.setLabelsVisible(false)
      return
    }

    if (this.labelsVisible) {
      return
    }

    if (forceImmediate) {
      this.setLabelsVisible(true, true)
      return
    }

    this.scheduleLabelResume()
  }

  private scheduleLabelResume(): void {
    if (this.labelResumeTimer !== undefined) {
      return
    }

    this.labelResumeTimer = setTimeout(() => {
      this.labelResumeTimer = undefined
      if (
        this.options.showLabels &&
        !this.cameraLabelsSuspended &&
        !this.loadingLabelsSuspended
      ) {
        this.setLabelsVisible(true)
      }
    }, this.labelResumeDelayMs)
  }

  private clearLabelResumeTimer(): void {
    if (this.labelResumeTimer !== undefined) {
      clearTimeout(this.labelResumeTimer)
      this.labelResumeTimer = undefined
    }
  }

  private setLabelsVisible(visible: boolean, forceSymbolRebuild = false): void {
    const nextVisible = this.options.showLabels && visible
    if (this.labelsVisible === nextVisible) {
      return
    }

    this.labelsVisible = nextVisible
    const revealExistingRuntimes = nextVisible && !this.symbolLayoutDirtyWhileHidden
    this.symbolRenderer.setVisible(revealExistingRuntimes)

    if (!nextVisible) {
      this.clearSymbolRebuildTimer()
      if (this.symbolLayoutDirty) {
        this.symbolLayoutDirtyWhileHidden = true
      }
      this.scene.requestRender()
      return
    }

    if (
      this.symbolRenderer.runtimeCount === 0 ||
      this.symbolLayoutDirty ||
      this.symbolLayoutDirtyWhileHidden
    ) {
      this.scheduleSymbolRebuild(forceSymbolRebuild)
    }

    this.scene.requestRender()
  }

  destroy(): void {
    this.destroyed = true
    this.clearSymbolRebuildTimer()
    this.clearVisibleTileRefreshTimer()
    this.clearViewportUpdateTimer()
    this.unsubscribeViewport?.()
    this.unsubscribeTiles()
    this.unsubscribeScheduler?.()
    this.removeCameraMoveStart?.()
    this.removeCameraMoveStart = undefined
    this.removeCameraMoveEnd?.()
    this.removeCameraMoveEnd = undefined
    this.clearLabelResumeTimer()
    this.symbolRenderer.destroy()

    for (const group of this.groups.values()) {
      group.destroy()
    }
    this.groups.clear()
  }

  private handleTileEvent = (event: TileDecodeEvent): void => {
    if (this.cameraMoving) {
      this.suppressedTileEventsDuringCameraMove = true
      this.scheduleViewportUpdate(true)
      return
    }

    if (this.visibleTileRefreshTimer !== undefined) {
      this.suppressedTileEventsDuringCameraMove = true
      return
    }

    if (event.type === 'decoded') {
      if (this.sourceCache && !this.sourceCache.isVisible(event.tile.id)) {
        return
      }
      this.addTile(event.tile)
    } else {
      this.removeTile(event.tileId)
    }
  }

  private handleViewportEvent = (snapshot: MvtViewportSnapshot): void => {
    if (this.cameraMoving) {
      this.currentZoom = snapshot.zoom
      this.pendingViewportSnapshot = snapshot
      this.scheduleViewportUpdate()
      return
    }

    this.applyViewportSnapshot(snapshot)
  }

  private handleCameraMoveStateChange(moving: boolean): void {
    if (this.cameraMoving === moving) {
      return
    }

    this.cameraMoving = moving
    if (this.options.showLabels && this.suspendLabelsDuringCameraMove) {
      this.setCameraLabelSuspended(moving)
    }

    if (moving) {
      return
    }

    const pendingViewportSnapshot = this.pendingViewportSnapshot
    const suppressedTileEvents = this.suppressedTileEventsDuringCameraMove

    if (pendingViewportSnapshot) {
      this.flushViewportUpdate(true)
      return
    }

    if (suppressedTileEvents) {
      this.suppressedTileEventsDuringCameraMove = false
      this.scheduleVisibleTileRefresh()
    }
  }

  private applyViewportSnapshot(
    snapshot: MvtViewportSnapshot,
    forceTileRefresh = false,
  ): void {
    const previousZoom = this.currentZoom
    this.currentZoom = snapshot.zoom
    const zoomChanged = previousZoom !== this.currentZoom

    let tileSetChanged = false

    for (const tileId of snapshot.exitedTileIds) {
      if (!this.groups.has(tileId)) {
        continue
      }

      this.removeTile(tileId, false)
      tileSetChanged = true
    }

    for (const tileId of snapshot.enteredTileIds) {
      if (this.groups.has(tileId)) {
        continue
      }

      const tile = this.scheduler.getTile(tileId)
      if (!tile) {
        continue
      }

      if (this.sourceCache && !this.sourceCache.isVisible(tileId)) {
        continue
      }

      this.addTile(tile)
      tileSetChanged = true
    }

    if (forceTileRefresh || (zoomChanged && this.styleRenderer)) {
      this.scheduleVisibleTileRefresh()
      return
    }

    if (tileSetChanged || zoomChanged) {
      this.scheduleSymbolRebuild()
    }
  }

  private scheduleAtlasRefresh(): void {
    if (this.atlasRefreshScheduled || this.destroyed) {
      return
    }

    this.atlasRefreshScheduled = true
    setTimeout(() => {
      this.atlasRefreshScheduled = false
      if (this.destroyed || !this.spriteAtlas?.isReady) {
        return
      }

      this.scheduleSymbolRebuild(true)
    }, 0)
  }

  private scheduleViewportUpdate(forceTileRefresh = false): void {
    if (this.destroyed) {
      return
    }

    if (forceTileRefresh) {
      this.pendingViewportRequiresTileRefresh = true
    }

    if (this.viewportUpdateTimer !== undefined) {
      return
    }

    this.viewportUpdateTimer = setTimeout(() => {
      this.viewportUpdateTimer = undefined
      this.flushViewportUpdate()
    }, this.movingViewportUpdateDelayMs)
  }

  private clearViewportUpdateTimer(): void {
    if (this.viewportUpdateTimer !== undefined) {
      clearTimeout(this.viewportUpdateTimer)
      this.viewportUpdateTimer = undefined
    }
  }

  private flushViewportUpdate(forceImmediate = false): void {
    this.clearViewportUpdateTimer()

    if (this.destroyed) {
      return
    }

    const pendingViewportSnapshot = this.pendingViewportSnapshot
    const forceTileRefresh =
      this.pendingViewportRequiresTileRefresh ||
      this.suppressedTileEventsDuringCameraMove

    this.pendingViewportSnapshot = undefined
    this.pendingViewportRequiresTileRefresh = false
    this.suppressedTileEventsDuringCameraMove = false

    if (pendingViewportSnapshot) {
      this.applyViewportSnapshot(
        pendingViewportSnapshot,
        forceImmediate || forceTileRefresh,
      )
      return
    }

    if (forceTileRefresh) {
      this.scheduleVisibleTileRefresh(forceImmediate)
    }
  }

  private scheduleVisibleTileRefresh(forceImmediate = false): void {
    if (this.destroyed) {
      return
    }

    if (forceImmediate) {
      this.clearVisibleTileRefreshTimer()
      this.flushVisibleTileRefresh()
      return
    }

    if (this.visibleTileRefreshTimer !== undefined) {
      return
    }

    this.visibleTileRefreshTimer = setTimeout(() => {
      this.visibleTileRefreshTimer = undefined
      this.flushVisibleTileRefresh()
    }, this.visibleTileRefreshDelayMs)
  }

  private clearVisibleTileRefreshTimer(): void {
    if (this.visibleTileRefreshTimer !== undefined) {
      clearTimeout(this.visibleTileRefreshTimer)
      this.visibleTileRefreshTimer = undefined
    }
  }

  private flushVisibleTileRefresh(): void {
    if (this.destroyed) {
      return
    }

    this.refreshVisibleTiles()
  }

  private refreshVisibleTiles(): void {
    if (!this.styleRenderer) {
      const cachedTiles = this.scheduler.getCachedTiles()

      for (const group of this.groups.values()) {
        group.destroy()
      }
      this.groups.clear()

      for (const tile of cachedTiles) {
        if (this.sourceCache && !this.sourceCache.isVisible(tile.id)) {
          continue
        }

        this.addTile(tile)
      }

      this.scene.requestRender()
      return
    }

    const zoom =
      estimateSceneZoom(this.scene) ??
      this.currentZoom ??
      this.sourceCache?.getSnapshot()?.level ??
      0
    const visibleTileIds = new Set(
      this.sourceCache
        ? this.sourceCache.getIds()
        : this.scheduler.getCachedTiles().map((tile) => tile.id),
    )

    let symbolRefreshNeeded = false

    for (const tileId of visibleTileIds) {
      const tile = this.scheduler.getTile(tileId)
      if (!tile) {
        continue
      }

      const group = this.groups.get(tileId)
      if (!group) {
        this.addTile(tile, zoom)
        continue
      }

      if (group.refreshState.full) {
        symbolRefreshNeeded = symbolRefreshNeeded || group.refreshState.symbols
        group.destroy()
        this.groups.delete(tileId)
        this.addTile(tile, zoom)
        continue
      }

      if (group.refreshState.paint) {
        this.applyPaintBindings(group.paintBindings, zoom)
      }

      if (group.refreshState.symbols) {
        symbolRefreshNeeded = true
        if (group.mode === 'generic') {
          group.destroy()
          this.groups.delete(tileId)
          this.addTile(tile, zoom)
          continue
        }

        group.symbolPlacements = this.collectStyledTileSymbolPlacements(tile, zoom)
        group.labelCount = group.symbolPlacements.length
        group.iconCount = group.symbolPlacements.filter(
          (placement) => !!placement.candidate.iconImageName,
        ).length
      }
    }

    if (symbolRefreshNeeded) {
      this.scheduleSymbolRebuild()
    }
    this.scene.requestRender()
  }

  private getCandidateDecodedLayers(
    tile: DecodedTileRecord,
    decodedLayersByName: Map<string, DecodedLayerRecord>,
    sourceLayer?: string,
  ): DecodedLayerRecord[] {
    if (sourceLayer) {
      const decodedLayer = decodedLayersByName.get(sourceLayer)
      return decodedLayer ? [decodedLayer] : []
    }

    return tile.layers
  }

  private collectTileRefreshState(
    tile: DecodedTileRecord,
    decodedLayersByName: Map<string, DecodedLayerRecord>,
  ): TileZoomRefreshState {
    if (!this.styleRenderer) {
      return createTileZoomRefreshState()
    }

    const refreshState = createTileZoomRefreshState()

    for (const compiled of this.styleRenderer.layers) {
      if (compiled.zoomRefreshMode === 'none') {
        continue
      }

      const appliesToTile = this.getCandidateDecodedLayers(
        tile,
        decodedLayersByName,
        compiled.sourceLayer,
      ).some((layer) => this.options.layerFilter(layer, tile))

      if (!appliesToTile) {
        continue
      }

      mergeRefreshState(refreshState, compiled.zoomRefreshMode)
    }

    return refreshState
  }

  private applyPaintBindings(bindings: StyledPaintBinding[], zoom: number): void {
    for (const binding of bindings) {
      switch (binding.type) {
        case 'line': {
          const lineColor = applyOpacity(
            binding.compiled.line.color?.evaluate(binding.feature, zoom) ??
              this.options.lineColor,
            binding.compiled.line.opacity?.evaluate(binding.feature, zoom),
          )
          const lineWidth =
            binding.compiled.line.width?.evaluate(binding.feature, zoom) ??
            this.options.lineWidth
          binding.polyline.width = lineWidth
          const material = binding.polyline.material
          if (material.type === Material.ColorType) {
            material.uniforms.color = Color.clone(
              lineColor,
              material.uniforms.color,
            )
          } else {
            binding.polyline.material = createPolylineMaterial(lineColor)
          }
          break
        }
        case 'circle': {
          const style = binding.compiled.circle
          const circleOpacity = style.opacity?.evaluate(binding.feature, zoom)
          const strokeOpacity = style.strokeOpacity?.evaluate(binding.feature, zoom) ?? 1
          const circleColor = applyOpacity(
            style.color?.evaluate(binding.feature, zoom) ??
              this.options.pointColor,
            circleOpacity,
          )
          const strokeColor = applyOpacity(
            style.strokeColor?.evaluate(binding.feature, zoom) ??
              this.options.pointOutlineColor,
            strokeOpacity,
          )
          const radius = style.radius?.evaluate(binding.feature, zoom) ?? 5
          binding.pointPrimitive.color = circleColor
          binding.pointPrimitive.outlineColor = strokeColor
          binding.pointPrimitive.pixelSize = Math.max(1, Math.round(radius * 2))
          binding.pointPrimitive.outlineWidth =
            style.strokeWidth?.evaluate(binding.feature, zoom) ?? 0
          break
        }
        default:
          break
      }
    }
  }

  private collectSortedStyledFeatures(
    compiled: CompiledStyleLayer,
    layer: DecodedLayerRecord,
    tile: DecodedTileRecord,
    zoom: number,
  ): StyledFeatureEntry[] {
    return layer.features
      .map((feature, featureIndex) => ({
        feature,
        featureIndex,
        sortKey: evaluateStyleLayerSortKey(compiled, feature, zoom),
      }))
      .filter(
        ({ feature }) =>
          this.options.featureFilter(feature, layer, tile) &&
          compiled.filter(feature, zoom),
      )
      .sort((left, right) => {
        const delta = left.sortKey - right.sortKey
        if (delta !== 0) {
          return delta
        }

        return left.featureIndex - right.featureIndex
      })
  }

  private addTile(tile: DecodedTileRecord, zoomOverride?: number): void {
    if (this.styleRenderer) {
      this.addStyledTile(tile, zoomOverride)
      return
    }

    this.addGenericTile(tile)
  }

  private addGenericTile(
    tile: DecodedTileRecord,
    refreshState: TileZoomRefreshState = createTileZoomRefreshState(),
  ): void {
    if (this.groups.has(tile.id)) {
      return
    }

    const tileOrderBase = tile.coord.level * 100_000
    const pointCollection = this.options.showPoints
      ? new PointPrimitiveCollection({
          show: true,
        })
      : undefined
    const lineCollection = this.options.showLines || this.options.showPolygonOutlines
      ? new PolylineCollection({
          show: true,
        })
      : undefined
    const polygonInstances: GeometryInstance[] = []

    if (pointCollection) {
      addPrimitiveOrdered(
        this.scene,
        this.primitiveOrderMap,
        pointCollection,
        tileOrderBase + 0,
      )
    }
    if (lineCollection) {
      addPrimitiveOrdered(
        this.scene,
        this.primitiveOrderMap,
        lineCollection,
        tileOrderBase + 10,
      )
    }
    let polygonPrimitive: Primitive | undefined

    const pointColor = this.options.pointColor
    const polygonFillColor = this.options.polygonFillColor
    const pointOutlineColor = this.options.pointOutlineColor

    let pointCount = 0
    let lineCount = 0
    let polygonCount = 0

    for (const layer of tile.layers) {
      if (!this.options.layerFilter(layer, tile)) {
        continue
      }

      for (const feature of layer.features) {
        if (!this.options.featureFilter(feature, layer, tile)) {
          continue
        }

        switch (feature.type) {
          case 'Point':
            pointCount += renderPointPrimitives({
              tilingScheme: this.tilingScheme,
              tile,
              extent: layer.extent,
              layerId: layer.name,
              feature,
              collection: pointCollection,
              color: pointColor,
              outlineColor: pointOutlineColor,
              pixelSize: this.options.pointPixelSize,
            })
            break
          case 'LineString':
            lineCount += renderLineStringPrimitives({
              tilingScheme: this.tilingScheme,
              tile,
              extent: layer.extent,
              layerId: layer.name,
              feature,
              collection: lineCollection,
              color: this.options.lineColor,
              width: this.options.lineWidth,
            })
            break
          case 'Polygon':
            polygonCount += renderPolygonPrimitives({
              tilingScheme: this.tilingScheme,
              tile,
              extent: layer.extent,
              layerId: layer.name,
              feature,
              instances: polygonInstances,
              color: polygonFillColor,
            })
            lineCount += renderLineStringPrimitives({
              tilingScheme: this.tilingScheme,
              tile,
              extent: layer.extent,
              layerId: layer.name,
              feature,
              collection: lineCollection,
              color: this.options.polygonOutlineColor,
              width: this.options.polygonOutlineWidth,
              closedLoop: true,
            })
            break
          default:
            break
        }
      }
    }

    if (this.options.showPolygonFills && polygonInstances.length > 0) {
      polygonPrimitive = new Primitive({
        geometryInstances: polygonInstances,
        appearance: new PerInstanceColorAppearance({
          translucent: true,
          closed: true,
        }),
        asynchronous: true,
        allowPicking: false,
        releaseGeometryInstances: true,
      })
      addPrimitiveOrdered(
        this.scene,
        this.primitiveOrderMap,
        polygonPrimitive,
        tileOrderBase + 20,
      )
    }

    const group: TilePrimitiveGroup = {
      mode: 'generic',
      refreshState,
      pointCount,
      lineCount,
      polygonCount,
      labelCount: 0,
      iconCount: 0,
      symbolPlacements: [],
      paintBindings: [],
      destroy: () => {
        removeAndDestroyPrimitive(this.scene, pointCollection)
        removeAndDestroyPrimitive(this.scene, lineCollection)
        removeAndDestroyPrimitive(this.scene, polygonPrimitive)
      },
    }

    this.groups.set(tile.id, group)
    this.scene.requestRender()
  }

  private removeTile(tileId: string, scheduleSymbolRebuild = true): void {
    const group = this.groups.get(tileId)
    if (!group) {
      return
    }

    group.destroy()
    this.groups.delete(tileId)
    if (scheduleSymbolRebuild) {
      this.scheduleSymbolRebuild()
    }
    this.scene.requestRender()
  }

  private addStyledTile(tile: DecodedTileRecord, zoomOverride?: number): void {
    if (this.groups.has(tile.id) || !this.styleRenderer) {
      return
    }

    const zoom =
      zoomOverride ??
      estimateSceneZoom(this.scene) ??
      this.currentZoom ??
      tile.coord.level
    const destroyers: Array<() => void> = []
    const styledSymbolPlacements: StyledSymbolPlacement[] = []
    const paintBindings: StyledPaintBinding[] = []
    let pointCount = 0
    let lineCount = 0
    let polygonCount = 0
    let labelCount = 0
    let iconCount = 0
    let handledStyledLayer = false

    const decodedLayersByName = new Map(
      tile.layers.map((layer) => [layer.name, layer]),
    )
    const refreshState = this.collectTileRefreshState(tile, decodedLayersByName)

    for (const compiled of this.styleRenderer.layers) {
      const candidateLayers = this.getCandidateDecodedLayers(
        tile,
        decodedLayersByName,
        compiled.sourceLayer,
      )

      for (const layer of candidateLayers) {
        if (!this.options.layerFilter(layer, tile)) {
          continue
        }

        if (!compiled.matches(layer, tile, zoom)) {
          continue
        }

        handledStyledLayer = true
        let pointCollection: PointPrimitiveCollection | undefined
        let lineCollection: PolylineCollection | undefined
        const polygonInstances: GeometryInstance[] = []
        let bucketPointCount = 0
        let bucketLineCount = 0
        let bucketPolygonCount = 0
        const bucketSymbolPlacements: StyledSymbolPlacement[] = []
        const layerOrderBase = tile.coord.level * 100_000 + compiled.order * 100

        const ensurePointCollection = () => {
          if (!pointCollection) {
            pointCollection = new PointPrimitiveCollection({
              show: true,
            })
            addPrimitiveOrdered(
              this.scene,
              this.primitiveOrderMap,
              pointCollection,
              layerOrderBase + 10,
            )
          }
          return pointCollection
        }

        const ensureLineCollection = () => {
          if (!lineCollection) {
            lineCollection = new PolylineCollection({
              show: true,
            })
            addPrimitiveOrdered(
              this.scene,
              this.primitiveOrderMap,
              lineCollection,
              layerOrderBase + 20,
            )
          }
          return lineCollection
        }

        const sortedFeatures = this.collectSortedStyledFeatures(
          compiled,
          layer,
          tile,
          zoom,
        )

        for (const { feature, featureIndex } of sortedFeatures) {
          switch (compiled.type) {
            case 'fill': {
              const style = compiled.fill
              if (!this.options.showPolygonFills) {
                break
              }

              const baseFillColor =
                style.color?.evaluate(feature, zoom) ??
                this.options.polygonFillColor
              const fillOpacity = style.opacity?.evaluate(feature, zoom)
              const fillColor = applyOpacity(baseFillColor, fillOpacity)

              bucketPolygonCount += renderPolygonPrimitives({
                tilingScheme: this.tilingScheme,
                tile,
                extent: layer.extent,
                layerId: compiled.id,
                feature,
                instances: polygonInstances,
                color: fillColor,
              })

              const fillAntialias =
                style.antialias?.evaluate(feature, zoom) ?? true
              if (
                this.options.showPolygonOutlines &&
                fillAntialias &&
                style.outlineColor !== undefined
              ) {
                const outlineCollection = ensureLineCollection()
                const outlineColor = applyOpacity(
                  style.outlineColor.evaluate(feature, zoom),
                  fillOpacity,
                )
                bucketLineCount += renderLineStringPrimitives({
                  tilingScheme: this.tilingScheme,
                  tile,
                  extent: layer.extent,
                  layerId: compiled.id,
                  feature,
                  collection: outlineCollection,
                  color: outlineColor,
                  width: 1,
                  closedLoop: true,
                })
              }
              break
            }
            case 'line': {
              const style = compiled.line
              if (!this.options.showLines) {
                break
              }

              const lineColor = applyOpacity(
                style.color?.evaluate(feature, zoom) ??
                  this.options.lineColor,
                style.opacity?.evaluate(feature, zoom),
              )
              const lineWidth = style.width?.evaluate(feature, zoom)
              const collection = ensureLineCollection()
              bucketLineCount += renderLineStringPrimitives({
                tilingScheme: this.tilingScheme,
                tile,
                extent: layer.extent,
                layerId: compiled.id,
                feature,
                collection,
                color: lineColor,
                width: lineWidth ?? this.options.lineWidth,
                onPolyline:
                  compiled.zoomRefreshMode === 'paint'
                    ? (polyline) => {
                        paintBindings.push({
                          type: 'line',
                          compiled,
                          feature,
                          polyline,
                        })
                      }
                    : undefined,
              })
              break
            }
            case 'circle': {
              const style = compiled.circle
              if (!this.options.showPoints) {
                break
              }

              const circleOpacity = style.opacity?.evaluate(feature, zoom)
              const strokeOpacity = style.strokeOpacity?.evaluate(feature, zoom) ?? 1
              const circleColor = applyOpacity(
                style.color?.evaluate(feature, zoom) ??
                  this.options.pointColor,
                circleOpacity,
              )
              const strokeColor = applyOpacity(
                style.strokeColor?.evaluate(feature, zoom) ??
                  this.options.pointOutlineColor,
                strokeOpacity,
              )
              const radius = style.radius?.evaluate(feature, zoom) ?? 5
              const pixelSize = Math.max(1, Math.round(radius * 2))
              const outlineWidth = style.strokeWidth?.evaluate(feature, zoom) ?? 0
              const collection = ensurePointCollection()
              bucketPointCount += renderPointPrimitives({
                tilingScheme: this.tilingScheme,
                tile,
                extent: layer.extent,
                layerId: compiled.id,
                feature,
                collection,
                color: circleColor,
                outlineColor: strokeColor,
                pixelSize,
                outlineWidth,
                onPoint:
                  compiled.zoomRefreshMode === 'paint'
                    ? (pointPrimitive) => {
                        paintBindings.push({
                          type: 'circle',
                          compiled,
                          feature,
                          pointPrimitive,
                        })
                      }
                    : undefined,
              })
              break
            }
            case 'symbol': {
              if (!this.options.showLabels) {
                break
              }

              const placement = createStyledSymbolPlacement({
                tilingScheme: this.tilingScheme,
                tile,
                layer,
                feature,
                featureIndex,
                compiled,
                zoom,
              })
              if (placement) {
                bucketSymbolPlacements.push(placement)
              }

              break
            }
            default:
              break
          }
        }

        if (bucketSymbolPlacements.length > 0) {
          styledSymbolPlacements.push(...bucketSymbolPlacements)
        }

        let polygonPrimitive: Primitive | undefined
        if (this.options.showPolygonFills && polygonInstances.length > 0) {
          polygonPrimitive = new Primitive({
            geometryInstances: polygonInstances,
            appearance: new PerInstanceColorAppearance({
              translucent: true,
              closed: true,
            }),
            asynchronous: true,
            allowPicking: false,
            releaseGeometryInstances: true,
          })
          addPrimitiveOrdered(
            this.scene,
            this.primitiveOrderMap,
            polygonPrimitive,
            layerOrderBase + 0,
          )
        }

        if (
          bucketPointCount > 0 ||
          bucketLineCount > 0 ||
          bucketPolygonCount > 0 ||
          bucketSymbolPlacements.length > 0
        ) {
          pointCount += bucketPointCount
          lineCount += bucketLineCount
          polygonCount += bucketPolygonCount
          labelCount += bucketSymbolPlacements.length
          iconCount += bucketSymbolPlacements.filter(
            (placement) => !!placement.candidate.iconImageName,
          ).length

          destroyers.push(() => {
            removeAndDestroyPrimitive(this.scene, pointCollection)
            removeAndDestroyPrimitive(this.scene, lineCollection)
            removeAndDestroyPrimitive(this.scene, polygonPrimitive)
          })
        }
      }
    }

    if (!handledStyledLayer) {
      this.addGenericTile(tile, refreshState)
      return
    }

    const group: TilePrimitiveGroup = {
      mode: 'styled',
      refreshState,
      pointCount,
      lineCount,
      polygonCount,
      labelCount,
      iconCount,
      symbolPlacements: styledSymbolPlacements,
      paintBindings,
      destroy: () => {
        for (const destroy of destroyers) {
          destroy()
        }
      },
    }

    this.groups.set(tile.id, group)
    if (styledSymbolPlacements.length > 0) {
      this.scheduleSymbolRebuild()
    }
    this.scene.requestRender()
  }

  private collectStyledTileSymbolPlacements(
    tile: DecodedTileRecord,
    zoom: number,
  ): StyledSymbolPlacement[] {
    if (!this.styleRenderer || !this.options.showLabels) {
      return []
    }

    const placements: StyledSymbolPlacement[] = []
    const decodedLayersByName = new Map(
      tile.layers.map((layer) => [layer.name, layer]),
    )

    for (const compiled of this.styleRenderer.layers) {
      if (compiled.type !== 'symbol') {
        continue
      }

      const candidateLayers = this.getCandidateDecodedLayers(
        tile,
        decodedLayersByName,
        compiled.sourceLayer,
      )

      for (const layer of candidateLayers) {
        if (!this.options.layerFilter(layer, tile)) {
          continue
        }

        if (!compiled.matches(layer, tile, zoom)) {
          continue
        }

        const sortedFeatures = this.collectSortedStyledFeatures(
          compiled,
          layer,
          tile,
          zoom,
        )

        for (const { feature, featureIndex } of sortedFeatures) {
          const placement = createStyledSymbolPlacement({
            tilingScheme: this.tilingScheme,
            tile,
            layer,
            feature,
            featureIndex,
            compiled,
            zoom,
          })
          if (placement) {
            placements.push(placement)
          }
        }
      }
    }

    return placements
  }

  private scheduleSymbolRebuild(forceImmediate = false): void {
    if (this.destroyed || !this.options.showLabels || !this.styleRenderer) {
      return
    }

    this.symbolLayoutDirty = true
    if (!this.labelsVisible) {
      this.symbolLayoutDirtyWhileHidden = true
      this.clearSymbolRebuildTimer()
      return
    }

    if (forceImmediate) {
      this.clearSymbolRebuildTimer()
      this.flushSymbolRebuild()
      return
    }

    if (this.symbolRebuildTimer !== undefined) {
      return
    }

    this.symbolRebuildTimer = setTimeout(() => {
      this.symbolRebuildTimer = undefined
      this.flushSymbolRebuild()
    }, this.symbolRebuildDelayMs)
  }

  private clearSymbolRebuildTimer(): void {
    if (this.symbolRebuildTimer !== undefined) {
      clearTimeout(this.symbolRebuildTimer)
      this.symbolRebuildTimer = undefined
    }
  }

  private flushSymbolRebuild(): void {
    if (this.destroyed || !this.symbolLayoutDirty) {
      return
    }

    if (!this.labelsVisible) {
      this.symbolLayoutDirtyWhileHidden = true
      return
    }

    this.symbolLayoutDirty = false
    this.symbolLayoutDirtyWhileHidden = false
    this.symbolRenderer.rebuild(
      this.collectStyledSymbolPlacements(),
      this.labelsVisible,
    )
  }

  private collectStyledSymbolPlacements(): StyledSymbolPlacement[] {
    return Array.from(this.groups.values()).flatMap(
      (group) => group.symbolPlacements,
    )
  }
}
