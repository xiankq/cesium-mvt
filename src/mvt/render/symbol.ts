import {
  BillboardCollection,
  Cartesian2,
  Color,
  type Scene,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
} from '../types'
import {
  resolveFormattedText,
  type CompiledSymbolLayer,
} from '../style/renderer'
import { ScreenLabelCollisionIndex } from './collision'
import { ScreenSymbolDedupeIndex } from './dedupe'
import {
  addPrimitiveOrdered,
  applyOpacity,
  getFeatureAnchor,
  removeAndDestroyPrimitive,
  tilePointToCartesian,
} from './geometry'
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
  resolveIconImageDimensions,
  resolveTextPixelOffset,
  type StyledSymbolPlacement,
  type SymbolBucketRuntime,
  textOffsetToPixelOffset,
  unionScreenRects,
  wrapSymbolText,
} from './label'
import type { MapLibreSpriteAtlas } from './sprite'
import { buildTextSpriteRequest, TextSpriteAtlas } from './text'

type CreateStyledSymbolPlacementOptions = {
  tilingScheme: TilingScheme
  tile: DecodedTileRecord
  layer: DecodedLayerRecord
  feature: DecodedFeatureRecord
  featureIndex: number
  compiled: CompiledSymbolLayer
  zoom: number
}

type PreparedStyledSymbolPlacement = StyledSymbolPlacement & {
  textAnchorCandidates: string[]
  screenY: number
}

export function createStyledSymbolPlacement(
  options: CreateStyledSymbolPlacementOptions,
): StyledSymbolPlacement | undefined {
  const {
    tilingScheme,
    tile,
    layer,
    feature,
    featureIndex,
    compiled,
    zoom,
  } = options
  const style = compiled.symbol
  const anchor = getFeatureAnchor(feature)
  if (!anchor) {
    return undefined
  }

  const position = tilePointToCartesian(
    tilingScheme,
    tile.coord,
    anchor,
    layer.extent,
  )

  const textSize = Math.max(
    1,
    style.textSize?.evaluate(feature, zoom) ?? 16,
  )
  const textFieldValue = style.textField?.evaluate(feature, zoom)
  const textInfo = resolveFormattedText(textFieldValue)
  const rawText = textInfo.text.trim()
  const textTransform =
    style.textTransform?.evaluate(feature, zoom) ?? 'none'
  const textMaxWidth = style.textMaxWidth?.evaluate(feature, zoom) ?? 10
  const textLineHeight = style.textLineHeight?.evaluate(feature, zoom) ?? 1.2
  const textLetterSpacing =
    style.textLetterSpacing?.evaluate(feature, zoom) ?? 0
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
    style.textFont?.evaluate(feature, zoom) ??
    textInfo.fontStack ??
    DEFAULT_TEXT_FONT_STACK
  const textOpacity = style.textOpacity?.evaluate(feature, zoom)
  const textColor = applyOpacity(
    style.textColor?.evaluate(feature, zoom) ??
      textInfo.textColor ??
      Color.WHITE,
    textOpacity,
  )
  const haloColor = applyOpacity(
    style.textHaloColor?.evaluate(feature, zoom) ??
      Color.TRANSPARENT,
    textOpacity,
  )
  const haloWidth = Math.max(
    0,
    style.textHaloWidth?.evaluate(feature, zoom) ?? 0,
  )
  const textHaloBlur = style.textHaloBlur?.evaluate(feature, zoom) ?? 0
  const textAnchorName = String(
    style.textAnchor?.evaluate(feature, zoom) ?? 'center',
  )
  const textVariableAnchors =
    style.textVariableAnchor?.evaluate(feature, zoom) ?? []
  const textJustify = style.textJustify?.evaluate(feature, zoom) ?? 'auto'
  const textOffset = textOffsetToPixelOffset(
    style.textOffset?.evaluate(feature, zoom),
    textSize,
  )
  const textTranslateValue = style.textTranslate?.evaluate(feature, zoom)
  const textTranslate = textTranslateValue
    ? new Cartesian2(textTranslateValue[0], textTranslateValue[1])
    : new Cartesian2(0, 0)
  const textRadialOffset = style.textRadialOffset?.evaluate(feature, zoom) ?? 0
  const textPadding = Math.max(
    0,
    style.textPadding?.evaluate(feature, zoom) ?? 2,
  )
  const textOverlap = style.textAllowOverlap?.evaluate(feature, zoom) ?? false
  const overlapMode =
    style.textOverlap?.evaluate(feature, zoom) ??
    (textOverlap ? 'always' : 'never')
  const ignorePlacement =
    style.textIgnorePlacement?.evaluate(feature, zoom) ?? false
  const textOptional = style.textOptional?.evaluate(feature, zoom) ?? false
  const sortKey = style.symbolSortKey?.evaluate(feature, zoom) ?? 0
  const symbolZOrder = style.symbolZOrder?.evaluate(feature, zoom) ?? 'auto'
  const iconImageName = style.iconImage?.evaluate(feature, zoom) || undefined
  const iconSize = Math.max(0.1, style.iconSize?.evaluate(feature, zoom) ?? 1)
  const iconOpacity = style.iconOpacity?.evaluate(feature, zoom) ?? 1
  const iconColor = applyOpacity(
    style.iconColor?.evaluate(feature, zoom) ??
      Color.BLACK,
    iconOpacity,
  )
  const iconAnchorName = String(
    style.iconAnchor?.evaluate(feature, zoom) ??
      textAnchorName,
  )
  const iconOrigins = parseTextAnchor(iconAnchorName)
  const iconOffsetValue = style.iconOffset?.evaluate(feature, zoom)
  const iconOffset = iconOffsetValue
    ? new Cartesian2(
        iconOffsetValue[0] * iconSize,
        iconOffsetValue[1] * iconSize,
      )
    : new Cartesian2(0, 0)
  const iconTranslateValue = style.iconTranslate?.evaluate(feature, zoom)
  const iconTranslate = iconTranslateValue
    ? new Cartesian2(iconTranslateValue[0], iconTranslateValue[1])
    : new Cartesian2(0, 0)
  const iconAllowOverlap =
    style.iconAllowOverlap?.evaluate(feature, zoom) ?? false
  const iconOverlapMode =
    style.iconOverlap?.evaluate(feature, zoom) ??
    (iconAllowOverlap ? 'always' : 'never')
  const iconIgnorePlacement =
    style.iconIgnorePlacement?.evaluate(feature, zoom) ?? false
  const iconOptional = style.iconOptional?.evaluate(feature, zoom) ?? false
  const iconHaloColor = applyOpacity(
    style.iconHaloColor?.evaluate(feature, zoom) ??
      Color.TRANSPARENT,
    iconOpacity,
  )
  const iconHaloWidth = Math.max(
    0,
    style.iconHaloWidth?.evaluate(feature, zoom) ?? 0,
  )
  const iconHaloBlur = Math.max(
    0,
    style.iconHaloBlur?.evaluate(feature, zoom) ?? 0,
  )
  const iconPadding = Math.max(
    0,
    style.iconPadding?.evaluate(feature, zoom) ?? 2,
  )
  const iconTextFit = style.iconTextFit?.evaluate(feature, zoom) ?? 'none'
  const iconTextFitPadding =
    style.iconTextFitPadding?.evaluate(feature, zoom) ??
    [0, 0, 0, 0]
  const iconRotate =
    -((style.iconRotate?.evaluate(feature, zoom) ?? 0) * Math.PI) /
    180
  const featureKey = feature.id ?? `${layer.name}:${featureIndex}`

  if (text.length === 0 && !iconImageName) {
    return undefined
  }

  return {
    tileId: tile.id,
    tileLevel: tile.coord.level,
    bucketKey: `${tile.id}:${compiled.id}`,
    bucketOrder: compiled.order,
    compiledId: compiled.id,
    candidate: {
      labelId: `${tile.id}:${compiled.id}:${featureKey}`,
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
      textAnchor: textAnchorName,
      textVariableAnchors,
      textPadding,
      textLineHeight,
      textLetterSpacing,
      textJustify,
      textTranslate,
      textRadialOffset,
      ignorePlacement,
      overlapMode,
      optional: textOptional,
      symbolZOrder,
      sortKey,
      iconImageName,
      iconSize,
      iconColor,
      iconOpacity,
      iconHaloColor,
      iconHaloWidth,
      iconHaloBlur,
      iconAnchor: iconAnchorName,
      iconVerticalOrigin: iconOrigins.verticalOrigin,
      iconOffset,
      iconTranslate,
      iconPadding,
      iconTextFit,
      iconTextFitPadding,
      iconIgnorePlacement,
      iconOverlapMode,
      iconOptional,
      iconRotate,
    },
  }
}

export class SymbolRenderer {
  private readonly scene: Scene
  private readonly primitiveOrderMap: WeakMap<object, number>
  private readonly spriteAtlas?: MapLibreSpriteAtlas
  private readonly labelCollisionIndex = new ScreenLabelCollisionIndex()
  private readonly symbolDedupeIndex = new ScreenSymbolDedupeIndex()
  private readonly textAtlas = new TextSpriteAtlas()
  private readonly symbolBucketRuntimes = new Map<string, SymbolBucketRuntime>()

  constructor(
    scene: Scene,
    primitiveOrderMap: WeakMap<object, number>,
    spriteAtlas?: MapLibreSpriteAtlas,
  ) {
    this.scene = scene
    this.primitiveOrderMap = primitiveOrderMap
    this.spriteAtlas = spriteAtlas
  }

  get runtimeCount(): number {
    return this.symbolBucketRuntimes.size
  }

  setVisible(visible: boolean): void {
    for (const runtime of this.symbolBucketRuntimes.values()) {
      runtime.setLabelsVisible(visible)
    }
  }

  clear(): void {
    for (const runtime of this.symbolBucketRuntimes.values()) {
      runtime.destroy()
    }
    this.symbolBucketRuntimes.clear()
    this.labelCollisionIndex.clear()
    this.symbolDedupeIndex.clear()
  }

  destroy(): void {
    this.clear()
    this.textAtlas.destroy()
  }

  rebuild(
    placements: StyledSymbolPlacement[],
    labelsVisible: boolean,
  ): void {
    this.clear()

    if (!labelsVisible || placements.length === 0) {
      this.scene.requestRender()
      return
    }

    const orderedPlacements = placements
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
      .sort((left, right) =>
        compareStyledSymbolPlacements(left, right),
      )

    for (const placement of orderedPlacements) {
      this.placeSymbol(placement, labelsVisible)
    }

    this.scene.requestRender()
  }

  private placeSymbol(
    placement: PreparedStyledSymbolPlacement,
    labelsVisible: boolean,
  ): void {
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
      const textOrigins = {
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
        textOrigins,
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
            textOrigins,
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
        this.labelCollisionIndex.canPlace(
          resolvedIconRect,
          iconPlacementMode,
        )

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

      const runtime = this.ensureRuntime(placement, labelsVisible)

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
          horizontalOrigin: textOrigins.horizontalOrigin,
          verticalOrigin: textOrigins.verticalOrigin,
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

  private ensureRuntime(
    placement: StyledSymbolPlacement,
    labelsVisible: boolean,
  ): SymbolBucketRuntime {
    const existing = this.symbolBucketRuntimes.get(placement.bucketKey)
    if (existing) {
      return existing
    }

    const layerOrderBase =
      placement.tileLevel * 100_000 + placement.bucketOrder * 100
    const textBillboardCollection = new BillboardCollection({
      show: labelsVisible,
    })
    addPrimitiveOrdered(
      this.scene,
      this.primitiveOrderMap,
      textBillboardCollection,
      layerOrderBase + 90,
    )

    const iconBillboardCollection = new BillboardCollection({
      show: labelsVisible,
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
}

function compareStyledSymbolPlacements(
  left: PreparedStyledSymbolPlacement,
  right: PreparedStyledSymbolPlacement,
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
