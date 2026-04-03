import {
  Cartesian3,
  Cartesian2,
  Cartographic,
  ColorGeometryInstanceAttribute,
  Color,
  GeometryInstance,
  HorizontalOrigin,
  Material,
  PointPrimitiveCollection,
  LabelCollection,
  LabelStyle,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  PerInstanceColorAppearance,
  Primitive,
  VerticalOrigin,
  type Scene,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
  MvtViewportSnapshot,
  TileGeometryPart,
  TileCoord,
} from './types'
import type { TileDecodeEvent } from './types'
import type { TileScheduler } from './tile-scheduler'
import type { CesiumMvtSourceCache } from './source-cache'
import type { MapLibreStyleDocument } from './maplibre-style'
import {
  compileMapLibreStyleRenderer,
  type CompiledMapLibreStyleRenderer,
} from './maplibre-style-renderer'

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
  destroy: () => void
}

const DEFAULT_POINT_COLOR = Color.fromCssColorString('#67d7ff')
const DEFAULT_LINE_COLOR = Color.fromCssColorString('#8c9eff')
const DEFAULT_POLYGON_FILL_COLOR = Color.fromCssColorString('#173b78')
DEFAULT_POLYGON_FILL_COLOR.alpha = 0.28
const DEFAULT_POLYGON_OUTLINE_COLOR = Color.fromCssColorString('#7c5cff')
const DEFAULT_POINT_OUTLINE_COLOR = Color.fromCssColorString('#06131f')

const scratchNativePosition = new Cartesian3()
const scratchCartographic = new Cartographic()

function tilePointToCartesian(
  tilingScheme: TilingScheme,
  tile: TileCoord,
  point: [number, number],
  extent: number,
): Cartesian3 {
  const nativeRectangle = tilingScheme.tileXYToNativeRectangle(
    tile.x,
    tile.y,
    tile.level,
  )

  const xRatio = point[0] / extent
  const yRatio = point[1] / extent

  scratchNativePosition.x =
    nativeRectangle.west + xRatio * (nativeRectangle.east - nativeRectangle.west)
  scratchNativePosition.y =
    nativeRectangle.north - yRatio * (nativeRectangle.north - nativeRectangle.south)
  scratchNativePosition.z = 0

  const cartographic = tilingScheme.projection.unproject(
    scratchNativePosition,
    scratchCartographic,
  )

  return Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0)
}

function toPositions(
  tilingScheme: TilingScheme,
  tile: TileCoord,
  part: [number, number][],
  extent: number,
): Cartesian3[] {
  const positions: Cartesian3[] = []
  for (const point of part) {
    positions.push(tilePointToCartesian(tilingScheme, tile, point, extent))
  }
  return positions
}

function createPolylineMaterial(color: Color): Material {
  return Material.fromType(Material.ColorType, {
    color: Color.clone(color),
  })
}

function ensureClosedLoop(positions: Cartesian3[]): Cartesian3[] {
  if (positions.length < 3) return positions

  const first = positions[0]
  const last = positions[positions.length - 1]
  if (
    first.x === last.x &&
    first.y === last.y &&
    first.z === last.z
  ) {
    return positions
  }

  return [...positions, Cartesian3.clone(first)]
}

type PolygonRingGroup = {
  outer: TileGeometryPart
  holes: TileGeometryPart[]
}

function signedRingArea(part: TileGeometryPart): number {
  if (part.length < 3) return 0

  let area = 0
  for (let index = 0; index < part.length; index += 1) {
    const current = part[index]
    const next = part[(index + 1) % part.length]
    area += current[0] * next[1] - next[0] * current[1]
  }

  return area / 2
}

function groupPolygonRings(rings: TileGeometryPart[]): PolygonRingGroup[] {
  const groups: PolygonRingGroup[] = []
  let currentGroup: PolygonRingGroup | undefined

  for (const ring of rings) {
    if (ring.length < 3) continue

    const isHole = signedRingArea(ring) < 0
    if (!isHole || !currentGroup) {
      currentGroup = {
        outer: ring,
        holes: [],
      }
      groups.push(currentGroup)
      continue
    }

    currentGroup.holes.push(ring)
  }

  return groups
}

function applyOpacity(color: Color, opacity: number | undefined): Color {
  const next = Color.clone(color)
  if (opacity === undefined) {
    return next
  }

  next.alpha = Math.min(Math.max(next.alpha * opacity, 0), 1)
  return next
}

function firstFeatureText(feature: DecodedFeatureRecord): string | undefined {
  const preferredKeys = [
    'name',
    'name:en',
    'name_en',
    'title',
    'label',
    'ref',
  ]

  for (const key of preferredKeys) {
    const value = feature.properties[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text.length > 0) {
      return text
    }
  }

  return undefined
}

function computeLineMidpoint(part: TileGeometryPart): [number, number] {
  if (part.length === 0) {
    return [0, 0]
  }

  if (part.length === 1) {
    return part[0]
  }

  let totalLength = 0
  for (let index = 0; index < part.length - 1; index += 1) {
    const current = part[index]
    const next = part[index + 1]
    totalLength += Math.hypot(next[0] - current[0], next[1] - current[1])
  }

  if (totalLength === 0) {
    return part[0]
  }

  const midpoint = totalLength / 2
  let travelled = 0
  for (let index = 0; index < part.length - 1; index += 1) {
    const current = part[index]
    const next = part[index + 1]
    const segmentLength = Math.hypot(next[0] - current[0], next[1] - current[1])
    if (travelled + segmentLength >= midpoint) {
      const ratio = segmentLength === 0 ? 0 : (midpoint - travelled) / segmentLength
      return [
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ]
    }
    travelled += segmentLength
  }

  return part[part.length - 1]
}

function computeRingCentroid(part: TileGeometryPart): [number, number] {
  if (part.length === 0) {
    return [0, 0]
  }

  if (part.length === 1) {
    return part[0]
  }

  let twiceArea = 0
  let centerX = 0
  let centerY = 0

  for (let index = 0; index < part.length; index += 1) {
    const current = part[index]
    const next = part[(index + 1) % part.length]
    const cross = current[0] * next[1] - next[0] * current[1]
    twiceArea += cross
    centerX += (current[0] + next[0]) * cross
    centerY += (current[1] + next[1]) * cross
  }

  if (twiceArea === 0) {
    const average = part.reduce(
      (accumulator, point) => {
        accumulator[0] += point[0]
        accumulator[1] += point[1]
        return accumulator
      },
      [0, 0] as [number, number],
    )

    return [average[0] / part.length, average[1] / part.length]
  }

  return [centerX / (3 * twiceArea), centerY / (3 * twiceArea)]
}

function getFeatureAnchor(feature: DecodedFeatureRecord): [number, number] | undefined {
  const firstPart = feature.geometry[0]
  if (!firstPart || firstPart.length === 0) {
    return undefined
  }

  switch (feature.type) {
    case 'Point':
      return firstPart[0]
    case 'LineString':
      return computeLineMidpoint(firstPart)
    case 'Polygon':
      return computeRingCentroid(firstPart)
    default:
      return firstPart[0]
  }
}

function parseTextAnchor(anchor: string): {
  horizontalOrigin: HorizontalOrigin
  verticalOrigin: VerticalOrigin
} {
  switch (anchor) {
    case 'left':
      return {
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
      }
    case 'right':
      return {
        horizontalOrigin: HorizontalOrigin.RIGHT,
        verticalOrigin: VerticalOrigin.CENTER,
      }
    case 'top':
      return {
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.TOP,
      }
    case 'bottom':
      return {
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
      }
    case 'top-left':
      return {
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.TOP,
      }
    case 'top-right':
      return {
        horizontalOrigin: HorizontalOrigin.RIGHT,
        verticalOrigin: VerticalOrigin.TOP,
      }
    case 'bottom-left':
      return {
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.BOTTOM,
      }
    case 'bottom-right':
      return {
        horizontalOrigin: HorizontalOrigin.RIGHT,
        verticalOrigin: VerticalOrigin.BOTTOM,
      }
    default:
      return {
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
      }
  }
}

function textOffsetToPixelOffset(
  offset: [number, number] | undefined,
  textSize: number,
): Cartesian2 {
  if (!offset) {
    return new Cartesian2(0, 0)
  }

  return new Cartesian2(offset[0] * textSize, offset[1] * textSize)
}

function fontStackToCss(fontStack: unknown, fallback = 'sans-serif'): string {
  if (Array.isArray(fontStack)) {
    const names = fontStack
      .map((font) => String(font).trim())
      .filter((font) => font.length > 0)
    if (names.length > 0) {
      return names.join(', ')
    }
  }

  if (typeof fontStack === 'string' && fontStack.trim().length > 0) {
    return fontStack.trim()
  }

  return fallback
}

function removeAndDestroyPrimitive<T extends { destroy: () => void; isDestroyed: () => boolean }>(
  scene: Scene,
  primitive: T | undefined,
): void {
  if (!primitive) return
  if (primitive.isDestroyed()) return

  scene.primitives.remove(primitive)
  if (!primitive.isDestroyed()) {
    primitive.destroy()
  }
}

export class CesiumMvtPrimitiveLayer {
  private readonly scene: Scene
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
  private readonly sourceCache?: CesiumMvtSourceCache
  private readonly styleRenderer?: CompiledMapLibreStyleRenderer
  private readonly unsubscribeTiles: () => void
  private readonly unsubscribeViewport?: () => void
  private currentZoom = 0

  constructor(
    scene: Scene,
    scheduler: TileScheduler,
    tilingScheme: TilingScheme,
    options: CesiumMvtPrimitiveLayerOptions = {},
  ) {
    this.scene = scene
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

    this.sourceCache = options.sourceCache
    this.styleRenderer = options.style ? compileMapLibreStyleRenderer(options.style) : undefined

    this.unsubscribeTiles = scheduler.subscribeTiles(this.handleTileEvent)

    if (this.sourceCache) {
      this.unsubscribeViewport = this.sourceCache.subscribe(this.handleViewportEvent)
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

  destroy(): void {
    this.unsubscribeViewport?.()
    this.unsubscribeTiles()

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
    this.currentZoom = snapshot.zoom

    for (const tileId of snapshot.exitedTileIds) {
      this.removeTile(tileId)
    }

    for (const tileId of snapshot.enteredTileIds) {
      const cachedTile = this.sourceCache?.getTile(tileId)
      if (cachedTile) {
        this.addTile(cachedTile)
      }
    }
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
      this.scene.primitives.add(pointCollection)
    }
    if (lineCollection) {
      this.scene.primitives.add(lineCollection)
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
      this.scene.primitives.add(polygonPrimitive)
    }

    const group: TilePrimitiveGroup = {
      pointCount,
      lineCount,
      polygonCount,
      labelCount: 0,
      destroy: () => {
        removeAndDestroyPrimitive(this.scene, pointCollection)
        removeAndDestroyPrimitive(this.scene, lineCollection)
        removeAndDestroyPrimitive(this.scene, polygonPrimitive)
      },
    }

    this.groups.set(tile.id, group)
    this.scene.requestRender()
  }

  private removeTile(tileId: string): void {
    const group = this.groups.get(tileId)
    if (!group) {
      return
    }

    group.destroy()
    this.groups.delete(tileId)
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

    const zoom = this.currentZoom || tile.coord.level
    const destroyers: Array<() => void> = []
    let pointCount = 0
    let lineCount = 0
    let polygonCount = 0
    let labelCount = 0
    let renderedStyledBucket = false

    for (const layer of tile.layers) {
      if (!this.options.layerFilter(layer, tile)) {
        continue
      }

      const styleLayers =
        this.styleRenderer.layersBySourceLayer.get(layer.name) ?? []

      for (const compiled of styleLayers) {
        if (!compiled.matches(layer, tile, zoom)) {
          continue
        }

        let pointCollection: PointPrimitiveCollection | undefined
        let lineCollection: PolylineCollection | undefined
        let labelCollection: LabelCollection | undefined
        const polygonInstances: GeometryInstance[] = []
        let bucketPointCount = 0
        let bucketLineCount = 0
        let bucketPolygonCount = 0
        let bucketLabelCount = 0

        const ensurePointCollection = () => {
          if (!pointCollection) {
            pointCollection = new PointPrimitiveCollection({
              show: true,
            })
            this.scene.primitives.add(pointCollection)
          }
          return pointCollection
        }

        const ensureLineCollection = () => {
          if (!lineCollection) {
            lineCollection = new PolylineCollection({
              show: true,
            })
            this.scene.primitives.add(lineCollection)
          }
          return lineCollection
        }

        const ensureLabelCollection = () => {
          if (!labelCollection) {
            labelCollection = new LabelCollection({
              scene: this.scene,
              show: true,
            })
            this.scene.primitives.add(labelCollection)
          }
          return labelCollection
        }

        for (const feature of layer.features) {
          if (!this.options.featureFilter(feature, layer, tile)) {
            continue
          }

          if (!compiled.filter(feature, zoom)) {
            continue
          }

          switch (compiled.type) {
            case 'fill': {
              if (!this.options.showPolygonFills) {
                break
              }

              const fillColor = applyOpacity(
                compiled.fill?.color?.evaluate(feature, zoom) ??
                  this.options.polygonFillColor,
                compiled.fill?.opacity?.evaluate(feature, zoom),
              )

              bucketPolygonCount += this.renderPolygons(
                tile,
                layer.extent,
                compiled.id,
                feature,
                polygonInstances,
                fillColor,
              )

              if (this.options.showPolygonOutlines) {
                const outlineCollection = ensureLineCollection()
                const outlineColor = applyOpacity(
                  compiled.fill?.outlineColor?.evaluate(feature, zoom) ?? fillColor,
                  compiled.fill?.opacity?.evaluate(feature, zoom),
                )
                bucketLineCount += this.renderPaths(
                  tile,
                  layer.extent,
                  compiled.id,
                  feature,
                  outlineCollection,
                  outlineColor,
                  true,
                  this.options.polygonOutlineWidth,
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

              const circleColor = applyOpacity(
                compiled.circle?.color?.evaluate(feature, zoom) ??
                  this.options.pointColor,
                compiled.circle?.opacity?.evaluate(feature, zoom),
              )
              const strokeColor = applyOpacity(
                compiled.circle?.strokeColor?.evaluate(feature, zoom) ??
                  this.options.pointOutlineColor,
                compiled.circle?.opacity?.evaluate(feature, zoom),
              )
              const radius = compiled.circle?.radius?.evaluate(feature, zoom) ?? 5
              const pixelSize = Math.max(1, Math.round(radius * 2))
              const outlineWidth = compiled.circle?.strokeWidth?.evaluate(feature, zoom)
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
              const rawText =
                compiled.symbol?.textField?.evaluate(feature, zoom) ??
                firstFeatureText(feature) ??
                ''
              const text = rawText.trim()

              if (this.options.showLabels && text.length > 0) {
                const labelCollectionInstance = ensureLabelCollection()
                const fontStack = compiled.symbol?.textFont?.evaluate(feature, zoom) ?? []
                const textColor = applyOpacity(
                  compiled.symbol?.textColor?.evaluate(feature, zoom) ?? Color.WHITE,
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
                const anchorName = String(
                  compiled.symbol?.textAnchor?.evaluate(feature, zoom) ?? 'center',
                )
                const origins = parseTextAnchor(anchorName)
                const pixelOffset = textOffsetToPixelOffset(
                  compiled.symbol?.textOffset?.evaluate(feature, zoom),
                  textSize,
                )

                labelCollectionInstance.add({
                  show: true,
                  position,
                  text,
                  font: `${textSize}px ${fontStackToCss(fontStack)}`,
                  style:
                    haloWidth > 0 && haloColor.alpha > 0
                      ? LabelStyle.FILL_AND_OUTLINE
                      : LabelStyle.FILL,
                  fillColor: textColor,
                  outlineColor: haloColor,
                  outlineWidth: haloWidth,
                  pixelOffset,
                  horizontalOrigin: origins.horizontalOrigin,
                  verticalOrigin: origins.verticalOrigin,
                  id: {
                    tileId: tile.id,
                    layer: compiled.id,
                    featureId: feature.id,
                  },
                })
                bucketLabelCount += 1
              }

              const shouldShowMarker =
                this.options.showPoints &&
                (compiled.symbol?.iconImage !== undefined || text.length === 0)

              if (shouldShowMarker) {
                const pointCollectionInstance = ensurePointCollection()
                const iconColor = applyOpacity(
                  compiled.symbol?.iconColor?.evaluate(feature, zoom) ??
                    this.options.pointColor,
                  compiled.symbol?.iconOpacity?.evaluate(feature, zoom),
                )
                const markerSize = Math.max(
                  4,
                  Math.round(
                    (compiled.symbol?.iconSize?.evaluate(feature, zoom) ?? 1) * 8,
                  ),
                )

                pointCollectionInstance.add({
                  show: true,
                  position,
                  color: iconColor,
                  outlineColor: this.options.pointOutlineColor,
                  outlineWidth: 1,
                  pixelSize: markerSize,
                  id: {
                    tileId: tile.id,
                    layer: compiled.id,
                    featureId: feature.id,
                  },
                })
                bucketPointCount += 1
              }
              break
            }
            default:
              break
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
          this.scene.primitives.add(polygonPrimitive)
        }

        if (
          bucketPointCount > 0 ||
          bucketLineCount > 0 ||
          bucketPolygonCount > 0 ||
          bucketLabelCount > 0
        ) {
          renderedStyledBucket = true
          pointCount += bucketPointCount
          lineCount += bucketLineCount
          polygonCount += bucketPolygonCount
          labelCount += bucketLabelCount

          destroyers.push(() => {
            removeAndDestroyPrimitive(this.scene, pointCollection)
            removeAndDestroyPrimitive(this.scene, lineCollection)
            removeAndDestroyPrimitive(this.scene, labelCollection)
            removeAndDestroyPrimitive(this.scene, polygonPrimitive)
          })
        }
      }
    }

    if (!renderedStyledBucket) {
      this.addGenericTile(tile)
      return
    }

    const group: TilePrimitiveGroup = {
      pointCount,
      lineCount,
      polygonCount,
      labelCount,
      destroy: () => {
        for (const destroy of destroyers) {
          destroy()
        }
      },
    }

    this.groups.set(tile.id, group)
    this.scene.requestRender()
  }
}
