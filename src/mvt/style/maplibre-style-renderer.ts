import {
  latest,
  type LayerSpecification,
  type StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec'
import { Color } from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
} from '../types'
import {
  buildStyleFeatureFilter,
  buildStyleLayerVisibility,
  compileBooleanExpression,
  compileColorExpression,
  compileEnumExpression,
  compileFontExpression,
  compileNumberExpression,
  compileNumberTupleExpression,
  compilePropertyExpression,
  compileStringExpression,
  compileTextAnchorExpression,
  compileTextJustifyExpression,
  compileTextOffsetExpression,
  compileTextOverlapExpression,
  compileTextTransformExpression,
  compileTextTranslateAnchorExpression,
  type CompiledStyleExpression,
} from './maplibre-style-expressions'

export { resolveFormattedText } from './maplibre-style-expressions'
export type { CompiledStyleExpression, ResolvedFormattedText } from './maplibre-style-expressions'

type SupportedStyleLayerType = 'fill' | 'line' | 'circle' | 'symbol'
type SupportedLayerSpecification = LayerSpecification & {
  type: SupportedStyleLayerType
  filter?: unknown
  'source-layer'?: string
  layout?: {
    visibility?: 'visible' | 'none'
    [key: string]: unknown
  }
  paint?: {
    [key: string]: unknown
  }
  minzoom?: number
  maxzoom?: number
}

export type CompiledStyleLayer = {
  id: string
  type: SupportedStyleLayerType
  order: number
  sourceLayer?: string
  minzoom?: number
  maxzoom?: number
  visible: boolean
  filter: (feature: DecodedFeatureRecord, zoom: number) => boolean
  matches: (
    layer: DecodedLayerRecord,
    tile: DecodedTileRecord,
    zoom: number,
  ) => boolean
  fill?: {
    color?: CompiledStyleExpression<Color>
    opacity?: CompiledStyleExpression<number>
    outlineColor?: CompiledStyleExpression<Color>
    antialias?: CompiledStyleExpression<boolean>
    sortKey?: CompiledStyleExpression<number>
  }
  line?: {
    color?: CompiledStyleExpression<Color>
    width?: CompiledStyleExpression<number>
    opacity?: CompiledStyleExpression<number>
    sortKey?: CompiledStyleExpression<number>
  }
  circle?: {
    color?: CompiledStyleExpression<Color>
    radius?: CompiledStyleExpression<number>
    strokeColor?: CompiledStyleExpression<Color>
    strokeWidth?: CompiledStyleExpression<number>
    opacity?: CompiledStyleExpression<number>
    strokeOpacity?: CompiledStyleExpression<number>
    sortKey?: CompiledStyleExpression<number>
  }
  symbol?: {
    textField?: CompiledStyleExpression<unknown>
    textSize?: CompiledStyleExpression<number>
    textMaxWidth?: CompiledStyleExpression<number>
    textLineHeight?: CompiledStyleExpression<number>
    textJustify?: CompiledStyleExpression<'auto' | 'left' | 'center' | 'right'>
    textTransform?: CompiledStyleExpression<'none' | 'uppercase' | 'lowercase'>
    textLetterSpacing?: CompiledStyleExpression<number>
    textColor?: CompiledStyleExpression<Color>
    textHaloColor?: CompiledStyleExpression<Color>
    textHaloWidth?: CompiledStyleExpression<number>
    textHaloBlur?: CompiledStyleExpression<number>
    textOpacity?: CompiledStyleExpression<number>
    textFont?: CompiledStyleExpression<string[]>
    textAnchor?: CompiledStyleExpression<string>
    textOffset?: CompiledStyleExpression<[number, number]>
    textTranslate?: CompiledStyleExpression<[number, number]>
    textTranslateAnchor?: CompiledStyleExpression<'map' | 'viewport'>
    textRadialOffset?: CompiledStyleExpression<number>
    textAllowOverlap?: CompiledStyleExpression<boolean>
    textOverlap?: CompiledStyleExpression<'never' | 'always' | 'cooperative'>
    textIgnorePlacement?: CompiledStyleExpression<boolean>
    textPadding?: CompiledStyleExpression<number>
    textOptional?: CompiledStyleExpression<boolean>
    textVariableAnchor?: CompiledStyleExpression<string[]>
    symbolSortKey?: CompiledStyleExpression<number>
    symbolZOrder?: CompiledStyleExpression<'auto' | 'viewport-y' | 'source'>
    iconAnchor?: CompiledStyleExpression<string>
    iconOffset?: CompiledStyleExpression<[number, number]>
    iconRotate?: CompiledStyleExpression<number>
    iconRotationAlignment?: CompiledStyleExpression<'map' | 'viewport' | 'auto'>
    iconTranslate?: CompiledStyleExpression<[number, number]>
    iconTranslateAnchor?: CompiledStyleExpression<'map' | 'viewport'>
    iconAllowOverlap?: CompiledStyleExpression<boolean>
    iconOverlap?: CompiledStyleExpression<'never' | 'always' | 'cooperative'>
    iconIgnorePlacement?: CompiledStyleExpression<boolean>
    iconOptional?: CompiledStyleExpression<boolean>
    iconPadding?: CompiledStyleExpression<number>
    iconTextFitPadding?: CompiledStyleExpression<[number, number, number, number]>
    iconImage?: CompiledStyleExpression<string>
    iconColor?: CompiledStyleExpression<Color>
    iconOpacity?: CompiledStyleExpression<number>
    iconHaloColor?: CompiledStyleExpression<Color>
    iconHaloWidth?: CompiledStyleExpression<number>
    iconHaloBlur?: CompiledStyleExpression<number>
    iconSize?: CompiledStyleExpression<number>
    iconTextFit?: CompiledStyleExpression<'none' | 'width' | 'height' | 'both'>
  }
}

export type CompiledMapLibreStyleRenderer = {
  layers: CompiledStyleLayer[]
  layersBySourceLayer: Map<string, CompiledStyleLayer[]>
}

const paintFillSpec = latest['paint_fill']
const paintLineSpec = latest['paint_line']
const paintCircleSpec = latest['paint_circle']
const paintSymbolSpec = latest['paint_symbol']
const paintBackgroundSpec = latest['paint_background']
const layoutFillSpec = latest['layout_fill']
const layoutLineSpec = latest['layout_line']
const layoutCircleSpec = latest['layout_circle']
const layoutSymbolSpec = latest['layout_symbol']
const defaultTextFontStack =
  (layoutSymbolSpec['text-font'].default as string[] | undefined) ?? [
    'Open Sans Regular',
    'Arial Unicode MS Regular',
  ]

const backgroundStyleFeature: DecodedFeatureRecord = {
  id: undefined,
  type: 'Unknown',
  bbox: [0, 0, 0, 0],
  properties: {},
  geometry: [],
}

function createCompiledLayer(
  layer: LayerSpecification,
  order: number,
): CompiledStyleLayer | undefined {
  if (layer.type !== 'fill' && layer.type !== 'line' && layer.type !== 'circle' && layer.type !== 'symbol') {
    return undefined
  }

  const supportedLayer = layer as SupportedLayerSpecification
  const visible = supportedLayer.layout?.visibility !== 'none'
  const sourceLayer = supportedLayer['source-layer']
  const matches = buildStyleLayerVisibility(supportedLayer)
  const filter = buildStyleFeatureFilter(supportedLayer)

  const compiled: CompiledStyleLayer = {
    id: layer.id,
    type: layer.type,
    order,
    sourceLayer,
    minzoom: layer.minzoom,
    maxzoom: layer.maxzoom,
    visible,
    filter,
    matches: (decodedLayer, tile, zoom) => {
      return visible && matches(decodedLayer, tile, zoom)
    },
  }

  if (layer.type === 'fill') {
    compiled.fill = {
      color: compileColorExpression(
        supportedLayer.paint?.['fill-color'],
        paintFillSpec['fill-color'],
        '#000000',
      ),
      opacity: compileNumberExpression(
        supportedLayer.paint?.['fill-opacity'],
        paintFillSpec['fill-opacity'],
        1,
      ),
      outlineColor:
        supportedLayer.paint?.['fill-outline-color'] !== undefined
          ? compileColorExpression(
              supportedLayer.paint['fill-outline-color'],
              paintFillSpec['fill-outline-color'],
              '#000000',
            )
          : undefined,
      antialias: compileBooleanExpression(
        supportedLayer.paint?.['fill-antialias'],
        paintFillSpec['fill-antialias'],
        true,
      ),
      sortKey: compileNumberExpression(
        supportedLayer.layout?.['fill-sort-key'],
        layoutFillSpec['fill-sort-key'],
      ),
    }
  }

  if (layer.type === 'line') {
    compiled.line = {
      color: compileColorExpression(
        supportedLayer.paint?.['line-color'],
        paintLineSpec['line-color'],
        '#000000',
      ),
      width: compileNumberExpression(
        supportedLayer.paint?.['line-width'],
        paintLineSpec['line-width'],
        1,
      ),
      opacity: compileNumberExpression(
        supportedLayer.paint?.['line-opacity'],
        paintLineSpec['line-opacity'],
        1,
      ),
      sortKey: compileNumberExpression(
        supportedLayer.layout?.['line-sort-key'],
        layoutLineSpec['line-sort-key'],
      ),
    }
  }

  if (layer.type === 'circle') {
    compiled.circle = {
      radius: compileNumberExpression(
        supportedLayer.paint?.['circle-radius'],
        paintCircleSpec['circle-radius'],
        5,
      ),
      color: compileColorExpression(
        supportedLayer.paint?.['circle-color'],
        paintCircleSpec['circle-color'],
        '#000000',
      ),
      strokeWidth: compileNumberExpression(
        supportedLayer.paint?.['circle-stroke-width'],
        paintCircleSpec['circle-stroke-width'],
        0,
      ),
      strokeColor: compileColorExpression(
        supportedLayer.paint?.['circle-stroke-color'],
        paintCircleSpec['circle-stroke-color'],
        '#000000',
      ),
      opacity: compileNumberExpression(
        supportedLayer.paint?.['circle-opacity'],
        paintCircleSpec['circle-opacity'],
        1,
      ),
      strokeOpacity: compileNumberExpression(
        supportedLayer.paint?.['circle-stroke-opacity'],
        paintCircleSpec['circle-stroke-opacity'],
        1,
      ),
      sortKey: compileNumberExpression(
        supportedLayer.layout?.['circle-sort-key'],
        layoutCircleSpec['circle-sort-key'],
      ),
    }
  }

  if (layer.type === 'symbol') {
    compiled.symbol = {
      textField:
        supportedLayer.layout?.['text-field'] !== undefined
          ? compilePropertyExpression<unknown>(
              supportedLayer.layout['text-field'],
              layoutSymbolSpec['text-field'],
              '',
            )
          : undefined,
      textSize: compileNumberExpression(
        supportedLayer.layout?.['text-size'],
        layoutSymbolSpec['text-size'],
        16,
      ),
      textMaxWidth: compileNumberExpression(
        supportedLayer.layout?.['text-max-width'],
        layoutSymbolSpec['text-max-width'],
        10,
      ),
      textLineHeight: compileNumberExpression(
        supportedLayer.layout?.['text-line-height'],
        layoutSymbolSpec['text-line-height'],
        1.2,
      ),
      textJustify:
        supportedLayer.layout?.['text-justify'] !== undefined
          ? compileTextJustifyExpression(
              supportedLayer.layout['text-justify'],
              layoutSymbolSpec['text-justify'],
            )
          : undefined,
      textTransform:
        supportedLayer.layout?.['text-transform'] !== undefined
          ? compileTextTransformExpression(
              supportedLayer.layout['text-transform'],
              layoutSymbolSpec['text-transform'],
            )
          : undefined,
      textLetterSpacing: compileNumberExpression(
        supportedLayer.layout?.['text-letter-spacing'],
        layoutSymbolSpec['text-letter-spacing'],
        0,
      ),
      textColor: compileColorExpression(
        supportedLayer.paint?.['text-color'],
        paintSymbolSpec['text-color'],
        '#000000',
      ),
      textHaloColor: compileColorExpression(
        supportedLayer.paint?.['text-halo-color'],
        paintSymbolSpec['text-halo-color'],
        'rgba(0, 0, 0, 0)',
      ),
      textHaloWidth: compileNumberExpression(
        supportedLayer.paint?.['text-halo-width'],
        paintSymbolSpec['text-halo-width'],
        0,
      ),
      textHaloBlur: compileNumberExpression(
        supportedLayer.paint?.['text-halo-blur'],
        paintSymbolSpec['text-halo-blur'],
        0,
      ),
      textOpacity: compileNumberExpression(
        supportedLayer.paint?.['text-opacity'],
        paintSymbolSpec['text-opacity'],
        1,
      ),
      textFont:
        compileFontExpression(
          supportedLayer.layout?.['text-font'],
          layoutSymbolSpec['text-font'],
          defaultTextFontStack,
        ),
      textAnchor:
        supportedLayer.layout?.['text-anchor'] !== undefined
          ? compileTextAnchorExpression(
              supportedLayer.layout['text-anchor'],
              layoutSymbolSpec['text-anchor'],
            )
          : undefined,
      textOffset:
        supportedLayer.layout?.['text-offset'] !== undefined
          ? compileTextOffsetExpression(
              supportedLayer.layout['text-offset'],
              layoutSymbolSpec['text-offset'],
            )
          : undefined,
      textTranslate:
        supportedLayer.paint?.['text-translate'] !== undefined
          ? compileTextOffsetExpression(
              supportedLayer.paint['text-translate'],
              paintSymbolSpec['text-translate'],
            )
          : undefined,
      textTranslateAnchor:
        supportedLayer.paint?.['text-translate-anchor'] !== undefined
          ? compileTextTranslateAnchorExpression(
              supportedLayer.paint['text-translate-anchor'],
              paintSymbolSpec['text-translate-anchor'],
            )
          : undefined,
      textRadialOffset: compileNumberExpression(
        supportedLayer.layout?.['text-radial-offset'],
        layoutSymbolSpec['text-radial-offset'],
        0,
      ),
      textAllowOverlap: compileBooleanExpression(
        supportedLayer.layout?.['text-allow-overlap'],
        layoutSymbolSpec['text-allow-overlap'],
        false,
      ),
      textOverlap:
        supportedLayer.layout?.['text-overlap'] !== undefined
          ? compileTextOverlapExpression(
              supportedLayer.layout['text-overlap'],
              layoutSymbolSpec['text-overlap'],
            )
          : undefined,
      textIgnorePlacement: compileBooleanExpression(
        supportedLayer.layout?.['text-ignore-placement'],
        layoutSymbolSpec['text-ignore-placement'],
        false,
      ),
      textPadding: compileNumberExpression(
        supportedLayer.layout?.['text-padding'],
        layoutSymbolSpec['text-padding'],
        2,
      ),
      textOptional: compileBooleanExpression(
        supportedLayer.layout?.['text-optional'],
        layoutSymbolSpec['text-optional'],
        false,
      ),
      textVariableAnchor:
        supportedLayer.layout?.['text-variable-anchor'] !== undefined
          ? compilePropertyExpression<string[]>(
              supportedLayer.layout['text-variable-anchor'],
              layoutSymbolSpec['text-variable-anchor'],
              undefined,
              (input) => {
                if (Array.isArray(input)) {
                  return input.map((value) => String(value))
                }

                if (typeof input === 'string' && input.length > 0) {
                  return [input]
                }

                return []
              },
            )
          : undefined,
      symbolSortKey: compileNumberExpression(
        supportedLayer.layout?.['symbol-sort-key'],
        layoutSymbolSpec['symbol-sort-key'],
      ),
      symbolZOrder: compileEnumExpression(
        supportedLayer.layout?.['symbol-z-order'],
        layoutSymbolSpec['symbol-z-order'],
        'auto',
      ),
      iconAnchor:
        supportedLayer.layout?.['icon-anchor'] !== undefined
          ? compileTextAnchorExpression(
              supportedLayer.layout['icon-anchor'],
              layoutSymbolSpec['icon-anchor'],
            )
          : undefined,
      iconOffset:
        supportedLayer.layout?.['icon-offset'] !== undefined
          ? compileTextOffsetExpression(
              supportedLayer.layout['icon-offset'],
              layoutSymbolSpec['icon-offset'],
            )
          : undefined,
      iconRotate: compileNumberExpression(
        supportedLayer.layout?.['icon-rotate'],
        layoutSymbolSpec['icon-rotate'],
        0,
      ),
      iconRotationAlignment:
        supportedLayer.layout?.['icon-rotation-alignment'] !== undefined
          ? compileEnumExpression<'map' | 'viewport' | 'auto'>(
              supportedLayer.layout['icon-rotation-alignment'],
              layoutSymbolSpec['icon-rotation-alignment'],
              'auto',
            )
          : undefined,
      iconTranslate:
        supportedLayer.paint?.['icon-translate'] !== undefined
          ? compileTextOffsetExpression(
              supportedLayer.paint['icon-translate'],
              paintSymbolSpec['icon-translate'],
            )
          : undefined,
      iconTranslateAnchor:
        supportedLayer.paint?.['icon-translate-anchor'] !== undefined
          ? compileTextTranslateAnchorExpression(
              supportedLayer.paint['icon-translate-anchor'],
              paintSymbolSpec['icon-translate-anchor'],
            )
          : undefined,
      iconAllowOverlap: compileBooleanExpression(
        supportedLayer.layout?.['icon-allow-overlap'],
        layoutSymbolSpec['icon-allow-overlap'],
        false,
      ),
      iconOverlap:
        supportedLayer.layout?.['icon-overlap'] !== undefined
          ? compileTextOverlapExpression(
              supportedLayer.layout['icon-overlap'],
              layoutSymbolSpec['icon-overlap'],
            )
          : undefined,
      iconIgnorePlacement: compileBooleanExpression(
        supportedLayer.layout?.['icon-ignore-placement'],
        layoutSymbolSpec['icon-ignore-placement'],
        false,
      ),
      iconOptional: compileBooleanExpression(
        supportedLayer.layout?.['icon-optional'],
        layoutSymbolSpec['icon-optional'],
        false,
      ),
      iconPadding: compileNumberExpression(
        supportedLayer.layout?.['icon-padding'],
        layoutSymbolSpec['icon-padding'],
        2,
      ),
      iconTextFitPadding:
        supportedLayer.layout?.['icon-text-fit-padding'] !== undefined
          ? compileNumberTupleExpression(
              supportedLayer.layout['icon-text-fit-padding'],
              layoutSymbolSpec['icon-text-fit-padding'],
              [0, 0, 0, 0],
            )
          : undefined,
      iconImage:
        supportedLayer.layout?.['icon-image'] !== undefined
          ? compileStringExpression(
              supportedLayer.layout['icon-image'],
              layoutSymbolSpec['icon-image'],
              '',
            )
          : undefined,
      iconColor: compileColorExpression(
        supportedLayer.paint?.['icon-color'],
        paintSymbolSpec['icon-color'],
        '#000000',
      ),
      iconOpacity: compileNumberExpression(
        supportedLayer.paint?.['icon-opacity'],
        paintSymbolSpec['icon-opacity'],
        1,
      ),
      iconHaloColor: compileColorExpression(
        supportedLayer.paint?.['icon-halo-color'],
        paintSymbolSpec['icon-halo-color'],
        'rgba(0, 0, 0, 0)',
      ),
      iconHaloWidth: compileNumberExpression(
        supportedLayer.paint?.['icon-halo-width'],
        paintSymbolSpec['icon-halo-width'],
        0,
      ),
      iconHaloBlur: compileNumberExpression(
        supportedLayer.paint?.['icon-halo-blur'],
        paintSymbolSpec['icon-halo-blur'],
        0,
      ),
      iconSize:
        supportedLayer.layout?.['icon-size'] !== undefined
          ? compileNumberExpression(
              supportedLayer.layout['icon-size'],
              layoutSymbolSpec['icon-size'],
              1,
            )
          : undefined,
      iconTextFit:
        supportedLayer.layout?.['icon-text-fit'] !== undefined
          ? compileEnumExpression<'none' | 'width' | 'height' | 'both'>(
              supportedLayer.layout['icon-text-fit'],
              layoutSymbolSpec['icon-text-fit'],
              'none',
            )
          : undefined,
    }
  }

  return compiled
}

export function compileMapLibreStyleRenderer(
  style: StyleSpecification,
): CompiledMapLibreStyleRenderer {
  const layers: CompiledStyleLayer[] = []
  const layersBySourceLayer = new Map<string, CompiledStyleLayer[]>()

  for (const [order, layer] of (style.layers ?? []).entries()) {
    const compiled = createCompiledLayer(layer, order)
    if (!compiled) {
      continue
    }

    layers.push(compiled)

    if (compiled.sourceLayer) {
      const existing = layersBySourceLayer.get(compiled.sourceLayer)
      if (existing) {
        existing.push(compiled)
      } else {
        layersBySourceLayer.set(compiled.sourceLayer, [compiled])
      }
    }
  }

  return {
    layers,
    layersBySourceLayer,
  }
}

export function getStyledLayersForSourceLayer(
  renderer: CompiledMapLibreStyleRenderer | undefined,
  sourceLayer: string,
): CompiledStyleLayer[] {
  if (!renderer) return []
  return renderer.layersBySourceLayer.get(sourceLayer) ?? []
}

export function resolveMapLibreStyleBackgroundColor(
  style: StyleSpecification,
  zoom = 0,
): Color | undefined {
  const backgroundLayer = [...(style.layers ?? [])]
    .reverse()
    .find((layer): layer is LayerSpecification & {
      type: 'background'
      paint?: {
        [key: string]: unknown
      }
    } => layer.type === 'background')

  if (!backgroundLayer) {
    return undefined
  }

  const colorExpression = compileColorExpression(
    backgroundLayer.paint?.['background-color'],
    paintBackgroundSpec['background-color'],
    '#000000',
  )
  const opacityExpression = compileNumberExpression(
    backgroundLayer.paint?.['background-opacity'],
    paintBackgroundSpec['background-opacity'],
    1,
  )

  const backgroundColor = colorExpression?.evaluate(backgroundStyleFeature, zoom)
  if (!backgroundColor) {
    return undefined
  }

  const opacity = opacityExpression?.evaluate(backgroundStyleFeature, zoom) ?? 1
  const next = Color.clone(backgroundColor)
  next.alpha = Math.min(Math.max(next.alpha * opacity, 0), 1)
  return next
}
