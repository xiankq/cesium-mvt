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
  type CompiledStyleExpression,
} from './expressions'

export { resolveFormattedText } from './expressions'
export type { CompiledStyleExpression, ResolvedFormattedText } from './expressions'

type SupportedStyleLayerType = 'fill' | 'line' | 'circle' | 'symbol'
export type CompiledStyleRefreshMode = 'none' | 'symbols' | 'full'
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

type CompiledFillStyle = {
  color?: CompiledStyleExpression<Color>
  opacity?: CompiledStyleExpression<number>
  outlineColor?: CompiledStyleExpression<Color>
  antialias?: CompiledStyleExpression<boolean>
  sortKey?: CompiledStyleExpression<number>
}

type CompiledLineStyle = {
  color?: CompiledStyleExpression<Color>
  width?: CompiledStyleExpression<number>
  opacity?: CompiledStyleExpression<number>
  sortKey?: CompiledStyleExpression<number>
}

type CompiledCircleStyle = {
  color?: CompiledStyleExpression<Color>
  radius?: CompiledStyleExpression<number>
  strokeColor?: CompiledStyleExpression<Color>
  strokeWidth?: CompiledStyleExpression<number>
  opacity?: CompiledStyleExpression<number>
  strokeOpacity?: CompiledStyleExpression<number>
  sortKey?: CompiledStyleExpression<number>
}

type CompiledSymbolStyle = {
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
  iconTranslate?: CompiledStyleExpression<[number, number]>
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

type CompiledStyleLayerBase<TType extends SupportedStyleLayerType> = {
  id: string
  type: TType
  order: number
  sourceLayer?: string
  minzoom?: number
  maxzoom?: number
  visible: boolean
  zoomRefreshMode: CompiledStyleRefreshMode
  filter: (feature: DecodedFeatureRecord, zoom: number) => boolean
  matches: (
    layer: DecodedLayerRecord,
    tile: DecodedTileRecord,
    zoom: number,
  ) => boolean
}

export type CompiledFillLayer = CompiledStyleLayerBase<'fill'> & {
  fill: CompiledFillStyle
}

export type CompiledLineLayer = CompiledStyleLayerBase<'line'> & {
  line: CompiledLineStyle
}

export type CompiledCircleLayer = CompiledStyleLayerBase<'circle'> & {
  circle: CompiledCircleStyle
}

export type CompiledSymbolLayer = CompiledStyleLayerBase<'symbol'> & {
  symbol: CompiledSymbolStyle
}

export type CompiledStyleLayer =
  | CompiledFillLayer
  | CompiledLineLayer
  | CompiledCircleLayer
  | CompiledSymbolLayer

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

function createCompiledLayerBase<TType extends SupportedStyleLayerType>(
  layer: SupportedLayerSpecification & { type: TType },
  order: number,
): CompiledStyleLayerBase<TType> {
  const visible = layer.layout?.visibility !== 'none'
  const sourceLayer = layer['source-layer']
  const matches = buildStyleLayerVisibility(layer)
  const filter = buildStyleFeatureFilter(layer)

  return {
    id: layer.id,
    type: layer.type,
    order,
    sourceLayer,
    minzoom: layer.minzoom,
    maxzoom: layer.maxzoom,
    visible,
    zoomRefreshMode: 'none',
    filter,
    matches: (decodedLayer, tile, zoom) => visible && matches(decodedLayer, tile, zoom),
  }
}

function styleValueUsesZoom(value: unknown): boolean {
  if (value === 'zoom') {
    return true
  }

  if (Array.isArray(value)) {
    return value.some((entry) => styleValueUsesZoom(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => styleValueUsesZoom(entry))
  }

  return false
}

function expressionsUseZoom(
  ...expressions: Array<CompiledStyleExpression<unknown> | undefined>
): boolean {
  return expressions.some((expression) => expression?.zoomDependent === true)
}

function layerUsesZoom(
  layer: SupportedLayerSpecification,
  ...expressions: Array<CompiledStyleExpression<unknown> | undefined>
): boolean {
  return (
    layer.minzoom !== undefined ||
    layer.maxzoom !== undefined ||
    styleValueUsesZoom(layer.filter) ||
    expressionsUseZoom(...expressions)
  )
}

function resolveZoomRefreshMode(
  layerType: SupportedStyleLayerType,
  zoomDependent: boolean,
): CompiledStyleRefreshMode {
  if (!zoomDependent) {
    return 'none'
  }

  return layerType === 'symbol' ? 'symbols' : 'full'
}

function compileFillStyle(
  layer: SupportedLayerSpecification & { type: 'fill' },
): CompiledFillStyle {
  return {
    color: compileColorExpression(
      layer.paint?.['fill-color'],
      paintFillSpec['fill-color'],
      '#000000',
    ),
    opacity: compileNumberExpression(
      layer.paint?.['fill-opacity'],
      paintFillSpec['fill-opacity'],
      1,
    ),
    outlineColor:
      layer.paint?.['fill-outline-color'] !== undefined
        ? compileColorExpression(
            layer.paint['fill-outline-color'],
            paintFillSpec['fill-outline-color'],
            '#000000',
          )
        : undefined,
    antialias: compileBooleanExpression(
      layer.paint?.['fill-antialias'],
      paintFillSpec['fill-antialias'],
      true,
    ),
    sortKey: compileNumberExpression(
      layer.layout?.['fill-sort-key'],
      layoutFillSpec['fill-sort-key'],
    ),
  }
}

function compileLineStyle(
  layer: SupportedLayerSpecification & { type: 'line' },
): CompiledLineStyle {
  return {
    color: compileColorExpression(
      layer.paint?.['line-color'],
      paintLineSpec['line-color'],
      '#000000',
    ),
    width: compileNumberExpression(
      layer.paint?.['line-width'],
      paintLineSpec['line-width'],
      1,
    ),
    opacity: compileNumberExpression(
      layer.paint?.['line-opacity'],
      paintLineSpec['line-opacity'],
      1,
    ),
    sortKey: compileNumberExpression(
      layer.layout?.['line-sort-key'],
      layoutLineSpec['line-sort-key'],
    ),
  }
}

function compileCircleStyle(
  layer: SupportedLayerSpecification & { type: 'circle' },
): CompiledCircleStyle {
  return {
    radius: compileNumberExpression(
      layer.paint?.['circle-radius'],
      paintCircleSpec['circle-radius'],
      5,
    ),
    color: compileColorExpression(
      layer.paint?.['circle-color'],
      paintCircleSpec['circle-color'],
      '#000000',
    ),
    strokeWidth: compileNumberExpression(
      layer.paint?.['circle-stroke-width'],
      paintCircleSpec['circle-stroke-width'],
      0,
    ),
    strokeColor: compileColorExpression(
      layer.paint?.['circle-stroke-color'],
      paintCircleSpec['circle-stroke-color'],
      '#000000',
    ),
    opacity: compileNumberExpression(
      layer.paint?.['circle-opacity'],
      paintCircleSpec['circle-opacity'],
      1,
    ),
    strokeOpacity: compileNumberExpression(
      layer.paint?.['circle-stroke-opacity'],
      paintCircleSpec['circle-stroke-opacity'],
      1,
    ),
    sortKey: compileNumberExpression(
      layer.layout?.['circle-sort-key'],
      layoutCircleSpec['circle-sort-key'],
    ),
  }
}

function compileSymbolStyle(
  layer: SupportedLayerSpecification & { type: 'symbol' },
): CompiledSymbolStyle {
  return {
    textField:
      layer.layout?.['text-field'] !== undefined
        ? compilePropertyExpression<unknown>(
            layer.layout['text-field'],
            layoutSymbolSpec['text-field'],
            '',
          )
        : undefined,
    textSize: compileNumberExpression(
      layer.layout?.['text-size'],
      layoutSymbolSpec['text-size'],
      16,
    ),
    textMaxWidth: compileNumberExpression(
      layer.layout?.['text-max-width'],
      layoutSymbolSpec['text-max-width'],
      10,
    ),
    textLineHeight: compileNumberExpression(
      layer.layout?.['text-line-height'],
      layoutSymbolSpec['text-line-height'],
      1.2,
    ),
    textJustify:
      layer.layout?.['text-justify'] !== undefined
        ? compileTextJustifyExpression(
            layer.layout['text-justify'],
            layoutSymbolSpec['text-justify'],
          )
        : undefined,
    textTransform:
      layer.layout?.['text-transform'] !== undefined
        ? compileTextTransformExpression(
            layer.layout['text-transform'],
            layoutSymbolSpec['text-transform'],
          )
        : undefined,
    textLetterSpacing: compileNumberExpression(
      layer.layout?.['text-letter-spacing'],
      layoutSymbolSpec['text-letter-spacing'],
      0,
    ),
    textColor: compileColorExpression(
      layer.paint?.['text-color'],
      paintSymbolSpec['text-color'],
      '#000000',
    ),
    textHaloColor: compileColorExpression(
      layer.paint?.['text-halo-color'],
      paintSymbolSpec['text-halo-color'],
      'rgba(0, 0, 0, 0)',
    ),
    textHaloWidth: compileNumberExpression(
      layer.paint?.['text-halo-width'],
      paintSymbolSpec['text-halo-width'],
      0,
    ),
    textHaloBlur: compileNumberExpression(
      layer.paint?.['text-halo-blur'],
      paintSymbolSpec['text-halo-blur'],
      0,
    ),
    textOpacity: compileNumberExpression(
      layer.paint?.['text-opacity'],
      paintSymbolSpec['text-opacity'],
      1,
    ),
    textFont: compileFontExpression(
      layer.layout?.['text-font'],
      layoutSymbolSpec['text-font'],
      defaultTextFontStack,
    ),
    textAnchor:
      layer.layout?.['text-anchor'] !== undefined
        ? compileTextAnchorExpression(
            layer.layout['text-anchor'],
            layoutSymbolSpec['text-anchor'],
          )
        : undefined,
    textOffset:
      layer.layout?.['text-offset'] !== undefined
        ? compileTextOffsetExpression(
            layer.layout['text-offset'],
            layoutSymbolSpec['text-offset'],
          )
        : undefined,
    textTranslate:
      layer.paint?.['text-translate'] !== undefined
        ? compileTextOffsetExpression(
            layer.paint['text-translate'],
            paintSymbolSpec['text-translate'],
          )
        : undefined,
    textRadialOffset: compileNumberExpression(
      layer.layout?.['text-radial-offset'],
      layoutSymbolSpec['text-radial-offset'],
      0,
    ),
    textAllowOverlap: compileBooleanExpression(
      layer.layout?.['text-allow-overlap'],
      layoutSymbolSpec['text-allow-overlap'],
      false,
    ),
    textOverlap:
      layer.layout?.['text-overlap'] !== undefined
        ? compileTextOverlapExpression(
            layer.layout['text-overlap'],
            layoutSymbolSpec['text-overlap'],
          )
        : undefined,
    textIgnorePlacement: compileBooleanExpression(
      layer.layout?.['text-ignore-placement'],
      layoutSymbolSpec['text-ignore-placement'],
      false,
    ),
    textPadding: compileNumberExpression(
      layer.layout?.['text-padding'],
      layoutSymbolSpec['text-padding'],
      2,
    ),
    textOptional: compileBooleanExpression(
      layer.layout?.['text-optional'],
      layoutSymbolSpec['text-optional'],
      false,
    ),
    textVariableAnchor:
      layer.layout?.['text-variable-anchor'] !== undefined
        ? compilePropertyExpression<string[]>(
            layer.layout['text-variable-anchor'],
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
      layer.layout?.['symbol-sort-key'],
      layoutSymbolSpec['symbol-sort-key'],
    ),
    symbolZOrder: compileEnumExpression(
      layer.layout?.['symbol-z-order'],
      layoutSymbolSpec['symbol-z-order'],
      'auto',
    ),
    iconAnchor:
      layer.layout?.['icon-anchor'] !== undefined
        ? compileTextAnchorExpression(
            layer.layout['icon-anchor'],
            layoutSymbolSpec['icon-anchor'],
          )
        : undefined,
    iconOffset:
      layer.layout?.['icon-offset'] !== undefined
        ? compileTextOffsetExpression(
            layer.layout['icon-offset'],
            layoutSymbolSpec['icon-offset'],
          )
        : undefined,
    iconRotate: compileNumberExpression(
      layer.layout?.['icon-rotate'],
      layoutSymbolSpec['icon-rotate'],
      0,
    ),
    iconTranslate:
      layer.paint?.['icon-translate'] !== undefined
        ? compileTextOffsetExpression(
            layer.paint['icon-translate'],
            paintSymbolSpec['icon-translate'],
          )
        : undefined,
    iconAllowOverlap: compileBooleanExpression(
      layer.layout?.['icon-allow-overlap'],
      layoutSymbolSpec['icon-allow-overlap'],
      false,
    ),
    iconOverlap:
      layer.layout?.['icon-overlap'] !== undefined
        ? compileTextOverlapExpression(
            layer.layout['icon-overlap'],
            layoutSymbolSpec['icon-overlap'],
          )
        : undefined,
    iconIgnorePlacement: compileBooleanExpression(
      layer.layout?.['icon-ignore-placement'],
      layoutSymbolSpec['icon-ignore-placement'],
      false,
    ),
    iconOptional: compileBooleanExpression(
      layer.layout?.['icon-optional'],
      layoutSymbolSpec['icon-optional'],
      false,
    ),
    iconPadding: compileNumberExpression(
      layer.layout?.['icon-padding'],
      layoutSymbolSpec['icon-padding'],
      2,
    ),
    iconTextFitPadding:
      layer.layout?.['icon-text-fit-padding'] !== undefined
        ? compileNumberTupleExpression(
            layer.layout['icon-text-fit-padding'],
            layoutSymbolSpec['icon-text-fit-padding'],
            [0, 0, 0, 0],
          )
        : undefined,
    iconImage:
      layer.layout?.['icon-image'] !== undefined
        ? compileStringExpression(
            layer.layout['icon-image'],
            layoutSymbolSpec['icon-image'],
            '',
          )
        : undefined,
    iconColor: compileColorExpression(
      layer.paint?.['icon-color'],
      paintSymbolSpec['icon-color'],
      '#000000',
    ),
    iconOpacity: compileNumberExpression(
      layer.paint?.['icon-opacity'],
      paintSymbolSpec['icon-opacity'],
      1,
    ),
    iconHaloColor: compileColorExpression(
      layer.paint?.['icon-halo-color'],
      paintSymbolSpec['icon-halo-color'],
      'rgba(0, 0, 0, 0)',
    ),
    iconHaloWidth: compileNumberExpression(
      layer.paint?.['icon-halo-width'],
      paintSymbolSpec['icon-halo-width'],
      0,
    ),
    iconHaloBlur: compileNumberExpression(
      layer.paint?.['icon-halo-blur'],
      paintSymbolSpec['icon-halo-blur'],
      0,
    ),
    iconSize:
      layer.layout?.['icon-size'] !== undefined
        ? compileNumberExpression(
            layer.layout['icon-size'],
            layoutSymbolSpec['icon-size'],
            1,
          )
        : undefined,
    iconTextFit:
      layer.layout?.['icon-text-fit'] !== undefined
        ? compileEnumExpression<'none' | 'width' | 'height' | 'both'>(
            layer.layout['icon-text-fit'],
            layoutSymbolSpec['icon-text-fit'],
            'none',
          )
        : undefined,
  }
}

function createCompiledLayer(
  layer: LayerSpecification,
  order: number,
): CompiledStyleLayer | undefined {
  switch (layer.type) {
    case 'fill': {
      const supportedLayer = layer as SupportedLayerSpecification & { type: 'fill' }
      const base = createCompiledLayerBase(supportedLayer, order)
      const fill = compileFillStyle(supportedLayer)
      const zoomDependent = layerUsesZoom(
        supportedLayer,
        fill.color,
        fill.opacity,
        fill.outlineColor,
        fill.antialias,
        fill.sortKey,
      )
      return {
        ...base,
        zoomRefreshMode: resolveZoomRefreshMode('fill', zoomDependent),
        fill,
      }
    }
    case 'line': {
      const supportedLayer = layer as SupportedLayerSpecification & { type: 'line' }
      const base = createCompiledLayerBase(supportedLayer, order)
      const line = compileLineStyle(supportedLayer)
      const zoomDependent = layerUsesZoom(
        supportedLayer,
        line.color,
        line.width,
        line.opacity,
        line.sortKey,
      )
      return {
        ...base,
        zoomRefreshMode: resolveZoomRefreshMode('line', zoomDependent),
        line,
      }
    }
    case 'circle': {
      const supportedLayer = layer as SupportedLayerSpecification & { type: 'circle' }
      const base = createCompiledLayerBase(supportedLayer, order)
      const circle = compileCircleStyle(supportedLayer)
      const zoomDependent = layerUsesZoom(
        supportedLayer,
        circle.radius,
        circle.color,
        circle.strokeWidth,
        circle.strokeColor,
        circle.opacity,
        circle.strokeOpacity,
        circle.sortKey,
      )
      return {
        ...base,
        zoomRefreshMode: resolveZoomRefreshMode('circle', zoomDependent),
        circle,
      }
    }
    case 'symbol': {
      const supportedLayer = layer as SupportedLayerSpecification & { type: 'symbol' }
      const base = createCompiledLayerBase(supportedLayer, order)
      const symbol = compileSymbolStyle(supportedLayer)
      const zoomDependent = layerUsesZoom(
        supportedLayer,
        symbol.textField,
        symbol.textSize,
        symbol.textMaxWidth,
        symbol.textLineHeight,
        symbol.textJustify,
        symbol.textTransform,
        symbol.textLetterSpacing,
        symbol.textColor,
        symbol.textHaloColor,
        symbol.textHaloWidth,
        symbol.textHaloBlur,
        symbol.textOpacity,
        symbol.textFont,
        symbol.textAnchor,
        symbol.textOffset,
        symbol.textTranslate,
        symbol.textRadialOffset,
        symbol.textAllowOverlap,
        symbol.textOverlap,
        symbol.textIgnorePlacement,
        symbol.textPadding,
        symbol.textOptional,
        symbol.textVariableAnchor,
        symbol.symbolSortKey,
        symbol.symbolZOrder,
        symbol.iconAnchor,
        symbol.iconOffset,
        symbol.iconRotate,
        symbol.iconTranslate,
        symbol.iconAllowOverlap,
        symbol.iconOverlap,
        symbol.iconIgnorePlacement,
        symbol.iconOptional,
        symbol.iconPadding,
        symbol.iconTextFitPadding,
        symbol.iconImage,
        symbol.iconColor,
        symbol.iconOpacity,
        symbol.iconHaloColor,
        symbol.iconHaloWidth,
        symbol.iconHaloBlur,
        symbol.iconSize,
        symbol.iconTextFit,
      )
      return {
        ...base,
        zoomRefreshMode: resolveZoomRefreshMode('symbol', zoomDependent),
        symbol,
      }
    }
    default:
      return undefined
  }
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
