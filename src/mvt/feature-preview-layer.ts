import {
  Cartesian2,
  BillboardCollection,
  ColorGeometryInstanceAttribute,
  Color,
  GeometryInstance,
  PointPrimitiveCollection,
  PolygonGeometry,
  PolygonHierarchy,
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
} from './types'
import type { TileDecodeEvent } from './types'
import type { TileScheduler } from './tile-scheduler'
import type { CesiumMvtSourceCache } from './source-cache'
import type { MapLibreStyleDocument } from './maplibre-style'
import { MapLibreSpriteAtlas } from './sprite-atlas'
import { ScreenLabelCollisionIndex } from './label-collision'
import { ScreenSymbolDedupeIndex } from './symbol-dedupe'
import { TextSpriteAtlas, buildTextSpriteRequest } from './text-atlas'
import {
  compileMapLibreStyleRenderer,
  type CompiledMapLibreStyleRenderer,
} from './maplibre-style-renderer'
import { resolveFormattedText } from './maplibre-style-expressions'
import {
  addPrimitiveOrdered,
  applyOpacity,
  createPolylineMaterial,
  ensureClosedLoop,
  estimateSceneZoom,
  evaluateStyleLayerSortKey,
  getFeatureAnchor,
  groupPolygonRings,
  removeAndDestroyPrimitive,
  tilePointToCartesian,
  toPositions,
} from './feature-preview-geometry'
import {
  applyTextTransform,
  buildSymbolDedupeKey,
  combinePixelOffsets,
  estimateIconScreenRect,
  estimateSpriteScreenRect,
  normalizeSymbolKey,
  parseTextAnchor,
  resolveTextJustifyOrigin,
  DEFAULT_TEXT_FONT_STACK,
  resolveTextPixelOffset,
  resolveIconImageDimensions,
  type SymbolPlacementCandidate,
  type StyledSymbolPlacement,
  type SymbolBucketRuntime,
  textOffsetToPixelOffset,
  unionScreenRects,
  wrapSymbolText,
} from './feature-preview-symbols'

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
  private readonly labelCollisionIndex = new ScreenLabelCollisionIndex()
  private readonly symbolDedupeIndex = new ScreenSymbolDedupeIndex()
  private readonly spriteAtlas?: MapLibreSpriteAtlas
  private readonly textAtlas = new TextSpriteAtlas()
  private readonly sourceCache?: CesiumMvtSourceCache
  private readonly styleRenderer?: CompiledMapLibreStyleRenderer
  private readonly unsubscribeTiles: () => void
  private readonly unsubscribeScheduler?: () => void
  private readonly unsubscribeViewport?: () => void
  private readonly symbolBucketRuntimes = new Map<string, SymbolBucketRuntime>()
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
      this.setLabelsVisible(true)
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

  private setLabelsVisible(visible: boolean): void {
    const nextVisible = this.options.showLabels && visible
    if (this.labelsVisible === nextVisible) {
      return
    }

    this.labelsVisible = nextVisible
    for (const runtime of this.symbolBucketRuntimes.values()) {
      runtime.setLabelsVisible(nextVisible)
    }

    if (nextVisible && this.symbolBucketRuntimes.size === 0) {
      this.scheduleSymbolRebuild()
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
    this.destroySymbolBucketRuntimes()
    this.textAtlas.destroy()

    for (const group of this.groups.values()) {
      group.destroy()
    }
    this.groups.clear()
    this.labelCollisionIndex.clear()
    this.symbolDedupeIndex.clear()
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

    if (tileSetChanged || previousZoom !== this.currentZoom) {
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

    this.destroySymbolBucketRuntimes()
    this.labelCollisionIndex.clear()
    this.symbolDedupeIndex.clear()
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
            pointCount += this.renderPoints(
              tile,
              layer.extent,
              layer.name,
              feature,
              pointCollection,
              pointColor,
              pointOutlineColor,
            )
            break
          case 'LineString':
            lineCount += this.renderPaths(
              tile,
              layer.extent,
              layer.name,
              feature,
              lineCollection,
              this.options.lineColor,
              false,
            )
            break
          case 'Polygon':
            polygonCount += this.renderPolygons(
              tile,
              layer.extent,
              layer.name,
              feature,
              polygonInstances,
              polygonFillColor,
            )
            lineCount += this.renderPaths(
              tile,
              layer.extent,
              layer.name,
              feature,
              lineCollection,
              this.options.polygonOutlineColor,
              true,
            )
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

  private renderPoints(
    tile: DecodedTileRecord,
    extent: number,
    layerName: string,
    feature: DecodedFeatureRecord,
    collection: PointPrimitiveCollection | undefined,
    color: Color,
    outlineColor: Color,
    pixelSize?: number,
    outlineWidth?: number,
  ): number {
    if (!collection) return 0

    let count = 0
    for (const part of feature.geometry) {
      for (const point of part) {
        const position = tilePointToCartesian(
          this.tilingScheme,
          tile.coord,
          point,
          extent,
        )

        collection.add({
          show: true,
          position,
          color,
          outlineColor,
          outlineWidth: outlineWidth ?? 1,
          pixelSize: pixelSize ?? this.options.pointPixelSize,
          id: {
            tileId: tile.id,
            layer: layerName,
            featureId: feature.id,
          },
        })
        count += 1
      }
    }

    return count
  }

  private renderPaths(
    tile: DecodedTileRecord,
    extent: number,
    layerName: string,
    feature: DecodedFeatureRecord,
    collection: PolylineCollection | undefined,
    color: Color,
    loop: boolean,
    width?: number,
  ): number {
    if (!collection) return 0

    let count = 0
    for (const part of feature.geometry) {
      if (part.length < 2) continue

      const positions = toPositions(
        this.tilingScheme,
        tile.coord,
        part,
        extent,
      )
      if (positions.length < 2) continue

      collection.add({
        show: true,
        positions: loop ? ensureClosedLoop(positions) : positions,
        width:
          width ??
          (loop ? this.options.polygonOutlineWidth : this.options.lineWidth),
        material: createPolylineMaterial(color),
        loop: false,
        id: {
          tileId: tile.id,
          layer: layerName,
          featureId: feature.id,
        },
      })
      count += 1
    }

    return count
  }

  private renderPolygons(
    tile: DecodedTileRecord,
    extent: number,
    layerName: string,
    feature: DecodedFeatureRecord,
    instances: GeometryInstance[],
    color: Color,
  ): number {
    let count = 0

    for (const polygon of groupPolygonRings(feature.geometry)) {
      const outerPositions = toPositions(
        this.tilingScheme,
        tile.coord,
        polygon.outer,
        extent,
      )
      if (outerPositions.length < 3) continue

      const holes = polygon.holes
        .map((ring) =>
          toPositions(this.tilingScheme, tile.coord, ring, extent),
        )
        .filter((positions) => positions.length >= 3)
        .map((positions) => new PolygonHierarchy(ensureClosedLoop(positions)))

      const geometry = new PolygonGeometry({
        polygonHierarchy: new PolygonHierarchy(
          ensureClosedLoop(outerPositions),
          holes,
        ),
        vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
      })

      instances.push(
        new GeometryInstance({
          geometry,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(color),
          },
          id: {
            tileId: tile.id,
            layer: layerName,
            featureId: feature.id,
          },
        }),
      )

      count += 1
    }

    return count
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
        const symbolCandidates: SymbolPlacementCandidate[] = []
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
              if (!this.options.showPolygonFills) {
                break
              }

              const baseFillColor =
                compiled.fill?.color?.evaluate(feature, zoom) ??
                this.options.polygonFillColor
              const fillOpacity = compiled.fill?.opacity?.evaluate(feature, zoom)
              const fillColor = applyOpacity(baseFillColor, fillOpacity)

              bucketPolygonCount += this.renderPolygons(
                tile,
                layer.extent,
                compiled.id,
                feature,
                polygonInstances,
                fillColor,
              )

              const fillAntialias =
                compiled.fill?.antialias?.evaluate(feature, zoom) ?? true
              if (
                this.options.showPolygonOutlines &&
                fillAntialias &&
                compiled.fill?.outlineColor !== undefined
              ) {
                const outlineCollection = ensureLineCollection()
                const outlineColor = applyOpacity(
                  compiled.fill.outlineColor.evaluate(feature, zoom),
                  fillOpacity,
                )
                bucketLineCount += this.renderPaths(
                  tile,
                  layer.extent,
                  compiled.id,
                  feature,
                  outlineCollection,
                  outlineColor,
                  true,
                  1,
                )
              }
              break
            }
            case 'line': {
              if (!this.options.showLines) {
                break
              }

              const lineColor = applyOpacity(
                compiled.line?.color?.evaluate(feature, zoom) ??
                  this.options.lineColor,
                compiled.line?.opacity?.evaluate(feature, zoom),
              )
              const lineWidth = compiled.line?.width?.evaluate(feature, zoom)
              const collection = ensureLineCollection()
              bucketLineCount += this.renderPaths(
                tile,
                layer.extent,
                compiled.id,
                feature,
                collection,
                lineColor,
                false,
                lineWidth,
              )
              break
            }
            case 'circle': {
              if (!this.options.showPoints) {
                break
              }

              const circleOpacity =
                compiled.circle?.opacity?.evaluate(feature, zoom)
              const strokeOpacity =
                compiled.circle?.strokeOpacity?.evaluate(feature, zoom) ?? 1
              const circleColor = applyOpacity(
                compiled.circle?.color?.evaluate(feature, zoom) ??
                  this.options.pointColor,
                circleOpacity,
              )
              const strokeColor = applyOpacity(
                compiled.circle?.strokeColor?.evaluate(feature, zoom) ??
                  this.options.pointOutlineColor,
                strokeOpacity,
              )
              const radius = compiled.circle?.radius?.evaluate(feature, zoom) ?? 5
              const pixelSize = Math.max(1, Math.round(radius * 2))
              const outlineWidth =
                compiled.circle?.strokeWidth?.evaluate(feature, zoom) ?? 0
              const collection = ensurePointCollection()
              bucketPointCount += this.renderPoints(
                tile,
                layer.extent,
                compiled.id,
                feature,
                collection,
                circleColor,
                strokeColor,
                pixelSize,
                outlineWidth,
              )
              break
            }
            case 'symbol': {
              const anchor = getFeatureAnchor(feature)
              if (!anchor) {
                break
              }

              if (!this.options.showLabels) {
                break
              }

              const position = tilePointToCartesian(
                this.tilingScheme,
                tile.coord,
                anchor,
                layer.extent,
              )

              const textSize = Math.max(
                1,
                compiled.symbol?.textSize?.evaluate(feature, zoom) ?? 16,
              )
              const textFieldValue =
                compiled.symbol?.textField?.evaluate(feature, zoom)
              const textInfo = resolveFormattedText(textFieldValue)
              const rawText = textInfo.text.trim()
              const textTransform =
                compiled.symbol?.textTransform?.evaluate(feature, zoom) ??
                'none'
              const textMaxWidth =
                compiled.symbol?.textMaxWidth?.evaluate(feature, zoom) ?? 10
              const textLineHeight =
                compiled.symbol?.textLineHeight?.evaluate(feature, zoom) ?? 1.2
              const textLetterSpacing =
                compiled.symbol?.textLetterSpacing?.evaluate(feature, zoom) ?? 0
              const transformedText = applyTextTransform(rawText, textTransform)
              const wrappedText = wrapSymbolText(
                transformedText,
                textMaxWidth,
                textSize,
                textLetterSpacing,
              )
              const text = wrappedText.trim()
              const textKey = normalizeSymbolKey(transformedText)

              const fontStack =
                compiled.symbol?.textFont?.evaluate(feature, zoom) ??
                textInfo.fontStack ??
                DEFAULT_TEXT_FONT_STACK
              const textColor = applyOpacity(
                compiled.symbol?.textColor?.evaluate(feature, zoom) ??
                  textInfo.textColor ??
                  Color.WHITE,
                compiled.symbol?.textOpacity?.evaluate(feature, zoom),
              )
              const haloColor = applyOpacity(
                compiled.symbol?.textHaloColor?.evaluate(feature, zoom) ??
                  Color.TRANSPARENT,
                compiled.symbol?.textOpacity?.evaluate(feature, zoom),
              )
              const haloWidth = Math.max(
                0,
                compiled.symbol?.textHaloWidth?.evaluate(feature, zoom) ?? 0,
              )
              const textHaloBlur =
                compiled.symbol?.textHaloBlur?.evaluate(feature, zoom) ?? 0
              const textAnchorName = String(
                compiled.symbol?.textAnchor?.evaluate(feature, zoom) ?? 'center',
              )
              const textVariableAnchors =
                compiled.symbol?.textVariableAnchor?.evaluate(feature, zoom) ?? []
              const textJustify =
                compiled.symbol?.textJustify?.evaluate(feature, zoom) ?? 'auto'
              const origins = {
                ...parseTextAnchor(textAnchorName),
                horizontalOrigin: resolveTextJustifyOrigin(
                  textAnchorName,
                  textJustify,
                ),
              }
              const textOffset = textOffsetToPixelOffset(
                compiled.symbol?.textOffset?.evaluate(feature, zoom),
                textSize,
              )
              const textTranslate =
                compiled.symbol?.textTranslate?.evaluate(feature, zoom)
              const textTranslateOffset = textTranslate
                ? new Cartesian2(textTranslate[0], textTranslate[1])
                : undefined
              const textTranslateAnchor =
                compiled.symbol?.textTranslateAnchor?.evaluate(feature, zoom) ??
                'map'
              const textRadialOffset =
                compiled.symbol?.textRadialOffset?.evaluate(feature, zoom) ?? 0
              const textPadding = Math.max(
                0,
                compiled.symbol?.textPadding?.evaluate(feature, zoom) ?? 2,
              )
              const allowOverlap =
                compiled.symbol?.textAllowOverlap?.evaluate(feature, zoom) ??
                false
              const overlapMode =
                compiled.symbol?.textOverlap?.evaluate(feature, zoom) ??
                (allowOverlap ? 'always' : 'never')
              const ignorePlacement =
                compiled.symbol?.textIgnorePlacement?.evaluate(feature, zoom) ??
                false
              const textOptional =
                compiled.symbol?.textOptional?.evaluate(feature, zoom) ??
                false
              const sortKey =
                compiled.symbol?.symbolSortKey?.evaluate(feature, zoom) ?? 0
              const symbolZOrder =
                compiled.symbol?.symbolZOrder?.evaluate(feature, zoom) ?? 'auto'
              const iconImageName =
                compiled.symbol?.iconImage?.evaluate(feature, zoom) || undefined
              const iconSize =
                Math.max(0.1, compiled.symbol?.iconSize?.evaluate(feature, zoom) ?? 1)
              const iconColor = applyOpacity(
                compiled.symbol?.iconColor?.evaluate(feature, zoom) ??
                  Color.BLACK,
                compiled.symbol?.iconOpacity?.evaluate(feature, zoom),
              )
              const iconAnchorName = String(
                compiled.symbol?.iconAnchor?.evaluate(feature, zoom) ??
                  textAnchorName,
              )
              const iconOrigins = parseTextAnchor(iconAnchorName)
              const iconOffsetValue =
                compiled.symbol?.iconOffset?.evaluate(feature, zoom)
              const iconOffset = iconOffsetValue
                ? new Cartesian2(
                    iconOffsetValue[0] * iconSize,
                    iconOffsetValue[1] * iconSize,
                  )
                : new Cartesian2(0, 0)
              const iconTranslateValue =
                compiled.symbol?.iconTranslate?.evaluate(feature, zoom)
              const iconTranslate = iconTranslateValue
                ? new Cartesian2(iconTranslateValue[0], iconTranslateValue[1])
                : undefined
              const iconTranslateAnchor =
                compiled.symbol?.iconTranslateAnchor?.evaluate(feature, zoom) ??
                'map'
              const iconAllowOverlap =
                compiled.symbol?.iconAllowOverlap?.evaluate(feature, zoom) ??
                false
              const iconOverlapMode =
                compiled.symbol?.iconOverlap?.evaluate(feature, zoom) ??
                (iconAllowOverlap ? 'always' : 'never')
              const iconIgnorePlacement =
                compiled.symbol?.iconIgnorePlacement?.evaluate(feature, zoom) ??
                false
              const iconOptional =
                compiled.symbol?.iconOptional?.evaluate(feature, zoom) ?? false
              const iconHaloColor = applyOpacity(
                compiled.symbol?.iconHaloColor?.evaluate(feature, zoom) ??
                  Color.TRANSPARENT,
                compiled.symbol?.iconOpacity?.evaluate(feature, zoom),
              )
              const iconHaloWidth = Math.max(
                0,
                compiled.symbol?.iconHaloWidth?.evaluate(feature, zoom) ?? 0,
              )
              const iconHaloBlur = Math.max(
                0,
                compiled.symbol?.iconHaloBlur?.evaluate(feature, zoom) ?? 0,
              )
              const iconPadding = Math.max(
                0,
                compiled.symbol?.iconPadding?.evaluate(feature, zoom) ?? 2,
              )
              const iconTextFit =
                compiled.symbol?.iconTextFit?.evaluate(feature, zoom) ?? 'none'
              const iconTextFitPadding =
                compiled.symbol?.iconTextFitPadding?.evaluate(feature, zoom) ??
                [0, 0, 0, 0]
              const iconRotate =
                -((compiled.symbol?.iconRotate?.evaluate(feature, zoom) ?? 0) * Math.PI) /
                180
              const featureId = feature.id ?? `${layer.name}:${featureIndex}`

              if (text.length > 0 || iconImageName) {
                symbolCandidates.push({
                  labelId: `${tile.id}:${compiled.id}:${featureId}`,
                  featureId: feature.id,
                  sourceIndex: featureIndex,
                  position,
                  text: text.length > 0 ? text : undefined,
                  textKey: text.length > 0 ? textKey : undefined,
                  textSize,
                  fontStack,
                  textColor,
                  haloColor,
                  haloWidth,
                  haloBlur: textHaloBlur,
                  pixelOffset: textOffset,
                  horizontalOrigin: origins.horizontalOrigin,
                  verticalOrigin: origins.verticalOrigin,
                  textAnchor: textAnchorName,
                  textVariableAnchors,
                  textPadding,
                  textLineHeight,
                  textLetterSpacing,
                  textMaxWidth,
                  textJustify,
                  textTransform,
                  textTranslate: textTranslateOffset ?? new Cartesian2(0, 0),
                  textTranslateAnchor,
                  textRadialOffset,
                  allowOverlap,
                  ignorePlacement,
                  overlapMode,
                  optional: textOptional,
                  symbolZOrder,
                  sortKey,
                  iconImageName,
                  iconSize,
                  iconColor,
                  iconOpacity:
                    compiled.symbol?.iconOpacity?.evaluate(feature, zoom) ?? 1,
                  iconHaloColor,
                  iconHaloWidth,
                  iconHaloBlur,
                  iconAnchor: iconAnchorName,
                  iconVerticalOrigin: iconOrigins.verticalOrigin,
                  iconOffset,
                  iconTranslate: iconTranslate ?? new Cartesian2(0, 0),
                  iconTranslateAnchor,
                  iconPadding,
                  iconTextFit,
                  iconTextFitPadding,
                  iconAllowOverlap,
                  iconIgnorePlacement,
                  iconOverlapMode,
                  iconOptional,
                  iconRotate,
                })
              }

              break
            }
            default:
              break
          }
        }

        if (symbolCandidates.length > 0) {
          for (const candidate of symbolCandidates) {
            styledSymbolPlacements.push({
              tileId: tile.id,
              tileLevel: tile.coord.level,
              bucketKey: `${tile.id}:${compiled.id}`,
              bucketOrder: compiled.order,
              compiledId: compiled.id,
              candidate,
            })
          }
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
          symbolCandidates.length > 0
        ) {
          pointCount += bucketPointCount
          lineCount += bucketLineCount
          polygonCount += bucketPolygonCount
          labelCount += symbolCandidates.length
          iconCount += symbolCandidates.filter((candidate) => !!candidate.iconImageName).length

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

  private scheduleSymbolRebuild(): void {
    if (this.destroyed) {
      return
    }

    this.clearSymbolRebuildTimer()
    this.symbolRebuildTimer = setTimeout(() => {
      this.symbolRebuildTimer = undefined
      if (!this.destroyed) {
        this.rebuildStyledSymbols()
      }
    }, this.symbolRebuildDelayMs)
  }

  private clearSymbolRebuildTimer(): void {
    if (this.symbolRebuildTimer !== undefined) {
      clearTimeout(this.symbolRebuildTimer)
      this.symbolRebuildTimer = undefined
    }
  }

  private destroySymbolBucketRuntimes(): void {
    for (const runtime of this.symbolBucketRuntimes.values()) {
      runtime.destroy()
    }
    this.symbolBucketRuntimes.clear()
  }

  private compareStyledSymbolPlacements(
    left: StyledSymbolPlacement & { screenY: number },
    right: StyledSymbolPlacement & { screenY: number },
  ): number {
    const tileDelta = right.tileLevel - left.tileLevel
    if (tileDelta !== 0) {
      return tileDelta
    }

    const layerDelta = right.bucketOrder - left.bucketOrder
    if (layerDelta !== 0) {
      return layerDelta
    }

    const sortDelta = left.candidate.sortKey - right.candidate.sortKey
    if (sortDelta !== 0) {
      return sortDelta
    }

    const leftZOrder = left.candidate.symbolZOrder
    const rightZOrder = right.candidate.symbolZOrder

    if (leftZOrder === 'source' || rightZOrder === 'source') {
      return left.candidate.sourceIndex - right.candidate.sourceIndex
    }

    if (leftZOrder === 'viewport-y' || rightZOrder === 'viewport-y') {
      const yDelta = left.screenY - right.screenY
      if (yDelta !== 0) {
        return yDelta
      }
    }

    if (leftZOrder === 'auto' || rightZOrder === 'auto') {
      const yDelta = left.screenY - right.screenY
      if (yDelta !== 0) {
        return yDelta
      }
    }

    return left.candidate.sourceIndex - right.candidate.sourceIndex
  }

  private ensureSymbolBucketRuntime(
    placement: StyledSymbolPlacement,
  ): SymbolBucketRuntime {
    const existing = this.symbolBucketRuntimes.get(placement.bucketKey)
    if (existing) {
      return existing
    }

    const layerOrderBase =
      placement.tileLevel * 100_000 + placement.bucketOrder * 100
    const textBillboardCollection = new BillboardCollection({
      show: this.labelsVisible,
    })
    addPrimitiveOrdered(
      this.scene,
      this.primitiveOrderMap,
      textBillboardCollection,
      layerOrderBase + 90,
    )

    const iconBillboardCollection = new BillboardCollection({
      show: this.labelsVisible,
    })
    addPrimitiveOrdered(
      this.scene,
      this.primitiveOrderMap,
      iconBillboardCollection,
      layerOrderBase + 80,
    )

    const runtime: SymbolBucketRuntime = {
      tileId: placement.tileId,
      bucketKey: placement.bucketKey,
      order: placement.bucketOrder,
      textBillboardCollection,
      iconBillboardCollection,
      setLabelsVisible: (visible: boolean) => {
        textBillboardCollection.show = visible
        iconBillboardCollection.show = visible
      },
      destroy: () => {
        removeAndDestroyPrimitive(this.scene, textBillboardCollection)
        removeAndDestroyPrimitive(this.scene, iconBillboardCollection)
      },
    }

    this.symbolBucketRuntimes.set(placement.bucketKey, runtime)
    return runtime
  }

  private rebuildStyledSymbols(): void {
    this.destroySymbolBucketRuntimes()
    this.labelCollisionIndex.clear()
    this.symbolDedupeIndex.clear()

    if (!this.options.showLabels || !this.styleRenderer) {
      this.scene.requestRender()
      return
    }

    const placements = Array.from(this.groups.values())
      .flatMap((group) => group.symbolPlacements)
      .map((placement) => ({
        ...placement,
        textAnchorCandidates: placement.candidate.text
          ? Array.from(
              new Set(
                placement.candidate.textVariableAnchors.length > 0
                  ? placement.candidate.textVariableAnchors
                  : [placement.candidate.textAnchor],
              ),
            )
          : [placement.candidate.textAnchor],
        screenY:
          this.scene.cartesianToCanvasCoordinates(
            placement.candidate.position,
            new Cartesian2(),
          )?.y ?? 0,
      }))
      .sort((left, right) => this.compareStyledSymbolPlacements(left, right))

    for (const placement of placements) {
      const candidate = placement.candidate
      const textPlacementMode = candidate.ignorePlacement
        ? 'always'
        : candidate.overlapMode
      const iconPlacementMode = candidate.iconIgnorePlacement
        ? 'always'
        : candidate.iconOverlapMode
      const textAnchors =
        placement.textAnchorCandidates.length > 0
          ? placement.textAnchorCandidates
          : [candidate.textAnchor]

      let placed = false
      for (const textAnchorName of textAnchors) {
        const origins = {
          ...parseTextAnchor(textAnchorName),
          horizontalOrigin: resolveTextJustifyOrigin(
            textAnchorName,
            candidate.textJustify,
          ),
        }
        const textPixelOffset = resolveTextPixelOffset(
          candidate.pixelOffset,
          candidate.textTranslate,
          candidate.textRadialOffset,
          candidate.textSize,
          origins,
        )
        const textSprite = candidate.text
          ? this.textAtlas.resolveImage(
              buildTextSpriteRequest(candidate, candidate.text, textAnchorName),
            )
          : undefined
        const textRect = textSprite
          ? estimateSpriteScreenRect(
              this.scene,
              candidate.position,
              textSprite.width,
              textSprite.height,
              textPixelOffset,
              origins,
              0,
            )
          : undefined

        const iconOrigins = parseTextAnchor(candidate.iconAnchor)
        const iconPixelOffset = combinePixelOffsets(
          candidate.iconOffset,
          candidate.iconTranslate,
        )
        const spriteEntry = candidate.iconImageName
          ? this.spriteAtlas?.resolve(candidate.iconImageName)
          : undefined
        const spriteImage = candidate.iconImageName
          ? this.spriteAtlas?.getImage(candidate.iconImageName)
          : undefined
        const resolvedIconRect =
          spriteEntry && spriteImage
            ? (() => {
                const iconDimensions = resolveIconImageDimensions(
                  spriteEntry,
                  candidate.iconSize,
                  textRect,
                  candidate.iconTextFit ?? 'none',
                  candidate.iconTextFitPadding,
                )
                const iconRect = estimateIconScreenRect(
                  this.scene,
                  candidate.position,
                  iconDimensions.width,
                  iconDimensions.height,
                  iconPixelOffset,
                  {
                    horizontalOrigin: iconOrigins.horizontalOrigin,
                    verticalOrigin: candidate.iconVerticalOrigin,
                  },
                  candidate.iconPadding,
                )

                if (
                  !iconRect ||
                  (candidate.iconHaloWidth <= 0 && candidate.iconHaloBlur <= 0)
                ) {
                  return iconRect
                }

                const haloSpread =
                  candidate.iconHaloWidth + candidate.iconHaloBlur
                const haloRect = estimateIconScreenRect(
                  this.scene,
                  candidate.position,
                  iconDimensions.width + haloSpread * 2,
                  iconDimensions.height + haloSpread * 2,
                  iconPixelOffset,
                  {
                    horizontalOrigin: iconOrigins.horizontalOrigin,
                    verticalOrigin: candidate.iconVerticalOrigin,
                  },
                  candidate.iconPadding,
                )
                return haloRect ? unionScreenRects(iconRect, haloRect) : iconRect
              })()
            : undefined

        if (!textRect && !resolvedIconRect) {
          continue
        }

        const placementRect =
          textRect && resolvedIconRect
            ? unionScreenRects(textRect, resolvedIconRect)
            : textRect ?? resolvedIconRect
        if (!placementRect) {
          continue
        }

        const dedupeKey = buildSymbolDedupeKey(
          placement.compiledId,
          candidate,
          candidate.text,
        )
        if (!this.symbolDedupeIndex.canPlace(dedupeKey, placementRect)) {
          continue
        }

        const textFits =
          textRect !== undefined &&
          this.labelCollisionIndex.canPlace(textRect, textPlacementMode)
        const iconFits =
          resolvedIconRect !== undefined &&
          this.labelCollisionIndex.canPlace(resolvedIconRect, iconPlacementMode)

        const renderText =
          textRect !== undefined &&
          (textFits ||
            (iconFits && candidate.optional) ||
            (resolvedIconRect !== undefined && candidate.iconOptional) ||
            !resolvedIconRect)
        const renderIcon =
          resolvedIconRect !== undefined &&
          (iconFits ||
            (textFits && candidate.iconOptional) ||
            (textRect !== undefined && candidate.optional) ||
            !textRect)

        const acceptPlacement = candidate.text ? renderText : renderIcon
        if (!acceptPlacement) {
          continue
        }

        this.symbolDedupeIndex.add(candidate.labelId, dedupeKey, placementRect)

        const runtime = this.ensureSymbolBucketRuntime(placement)

        if (
          renderIcon &&
          spriteEntry &&
          spriteImage &&
          resolvedIconRect
        ) {
          const baseColor = spriteEntry.sdf
            ? candidate.iconColor
            : new Color(1, 1, 1, candidate.iconOpacity)
          const iconDimensions = resolveIconImageDimensions(
            spriteEntry,
            candidate.iconSize,
            textRect,
            candidate.iconTextFit ?? 'none',
            candidate.iconTextFitPadding,
          )
          const haloSpread = candidate.iconHaloWidth + candidate.iconHaloBlur

          if (haloSpread > 0 && candidate.iconHaloColor.alpha > 0) {
            runtime.iconBillboardCollection?.add({
              show: true,
              position: candidate.position,
              image: spriteImage,
              color: candidate.iconHaloColor,
              width: iconDimensions.width + haloSpread * 2,
              height: iconDimensions.height + haloSpread * 2,
              pixelOffset: iconPixelOffset,
              horizontalOrigin: iconOrigins.horizontalOrigin,
              verticalOrigin: candidate.iconVerticalOrigin,
              rotation: candidate.iconRotate,
              id: {
                tileId: placement.tileId,
                layer: placement.compiledId,
                featureId: candidate.featureId,
                placementId: `${candidate.labelId}:icon-halo`,
              },
            })
          }

          runtime.iconBillboardCollection?.add({
            show: true,
            position: candidate.position,
            image: spriteImage,
            color: baseColor,
            width: iconDimensions.width,
            height: iconDimensions.height,
            pixelOffset: iconPixelOffset,
            horizontalOrigin: iconOrigins.horizontalOrigin,
            verticalOrigin: candidate.iconVerticalOrigin,
            rotation: candidate.iconRotate,
            id: {
              tileId: placement.tileId,
              layer: placement.compiledId,
              featureId: candidate.featureId,
              placementId: `${candidate.labelId}:icon`,
            },
          })
          this.labelCollisionIndex.add(
            `${candidate.labelId}:icon`,
            resolvedIconRect,
            iconPlacementMode,
            !candidate.iconIgnorePlacement,
          )
        }

        if (renderText && textRect && candidate.text && textSprite) {
          runtime.textBillboardCollection?.add({
            show: true,
            position: candidate.position,
            image: textSprite.image,
            color: Color.WHITE,
            width: textSprite.width,
            height: textSprite.height,
            pixelOffset: textPixelOffset,
            horizontalOrigin: origins.horizontalOrigin,
            verticalOrigin: origins.verticalOrigin,
            id: {
              tileId: placement.tileId,
              layer: placement.compiledId,
              featureId: candidate.featureId,
              placementId: `${candidate.labelId}:text`,
            },
          })
          this.labelCollisionIndex.add(
            `${candidate.labelId}:text`,
            textRect,
            textPlacementMode,
            !candidate.ignorePlacement,
          )
        }

        placed = true
        break
      }

      if (!placed) {
        this.symbolDedupeIndex.remove(candidate.labelId)
      }
    }

    this.scene.requestRender()
  }
}
