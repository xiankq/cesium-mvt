import {
  Color,
  GeometryInstance,
  PointPrimitiveCollection,
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
  type CompiledMapLibreStyleRenderer,
} from '../style/renderer'
import {
  addPrimitiveOrdered,
  applyOpacity,
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
  pointCount: number
  lineCount: number
  polygonCount: number
  labelCount: number
  iconCount: number
  symbolPlacements: StyledSymbolPlacement[]
  destroy: () => void
}

const DEFAULT_POINT_COLOR = Color.fromCssColorString('#67d7ff')
const DEFAULT_LINE_COLOR = Color.fromCssColorString('#8c9eff')
const DEFAULT_POLYGON_FILL_COLOR = Color.fromCssColorString('#173b78')
DEFAULT_POLYGON_FILL_COLOR.alpha = 0.28
const DEFAULT_POLYGON_OUTLINE_COLOR = Color.fromCssColorString('#7c5cff')
const DEFAULT_POINT_OUTLINE_COLOR = Color.fromCssColorString('#06131f')

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
  private symbolRebuildTimer?: ReturnType<typeof setTimeout>
  private symbolLayoutDirty = false
  private symbolLayoutDirtyWhileHidden = false

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

    if (this.options.showLabels && this.suspendLabelsDuringCameraMove) {
      this.removeCameraMoveStart = this.scene.camera.moveStart.addEventListener(() => {
        this.setCameraLabelSuspended(true)
      })
      this.removeCameraMoveEnd = this.scene.camera.moveEnd.addEventListener(() => {
        this.setCameraLabelSuspended(false)
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

    if (zoomChanged && this.styleRenderer) {
      this.rebuildVisibleTiles()
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

      this.rebuildVisibleTiles()
    }, 0)
  }

  private rebuildVisibleTiles(): void {
    const cachedTiles = this.scheduler.getCachedTiles()

    this.symbolRenderer.clear()
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
  }

  private addTile(tile: DecodedTileRecord): void {
    if (this.styleRenderer) {
      this.addStyledTile(tile)
      return
    }

    this.addGenericTile(tile)
  }

  private addGenericTile(tile: DecodedTileRecord): void {
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
      pointCount,
      lineCount,
      polygonCount,
      labelCount: 0,
      iconCount: 0,
      symbolPlacements: [],
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

  private addStyledTile(tile: DecodedTileRecord): void {
    if (this.groups.has(tile.id) || !this.styleRenderer) {
      return
    }

    const zoom =
      estimateSceneZoom(this.scene) ?? this.currentZoom ?? tile.coord.level
    const destroyers: Array<() => void> = []
    const styledSymbolPlacements: StyledSymbolPlacement[] = []
    let pointCount = 0
    let lineCount = 0
    let polygonCount = 0
    let labelCount = 0
    let iconCount = 0
    let handledStyledLayer = false

    const decodedLayersByName = new Map(
      tile.layers.map((layer) => [layer.name, layer]),
    )

    for (const compiled of this.styleRenderer.layers) {
      const candidateLayers = compiled.sourceLayer
        ? (() => {
            const decodedLayer = decodedLayersByName.get(compiled.sourceLayer)
            return decodedLayer ? [decodedLayer] : []
          })()
        : tile.layers

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

        const sortedFeatures = layer.features
          .map((feature, featureIndex) => ({
            feature,
            featureIndex,
            sortKey: evaluateStyleLayerSortKey(compiled, feature, zoom),
          }))
          .filter(({ feature }) =>
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
      this.addGenericTile(tile)
      return
    }

    const group: TilePrimitiveGroup = {
      pointCount,
      lineCount,
      polygonCount,
      labelCount,
      iconCount,
      symbolPlacements: styledSymbolPlacements,
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
