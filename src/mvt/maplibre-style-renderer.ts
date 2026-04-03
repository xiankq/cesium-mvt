import {
  createPropertyExpression,
  featureFilter,
  isExpression,
  latest,
  type Feature as MapLibreFeature,
  Formatted,
  type LayerSpecification,
  type StylePropertySpecification,
  type StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec'
import { Color } from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
} from './types'

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

type StyleFeature = MapLibreFeature

export type CompiledStyleExpression<T> = {
  evaluate(feature: DecodedFeatureRecord, zoom: number): T
}

export type CompiledStyleLayer = {
  id: string
  type: SupportedStyleLayerType
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
  }
  line?: {
    color?: CompiledStyleExpression<Color>
    width?: CompiledStyleExpression<number>
    opacity?: CompiledStyleExpression<number>
  }
  circle?: {
    color?: CompiledStyleExpression<Color>
    radius?: CompiledStyleExpression<number>
    strokeColor?: CompiledStyleExpression<Color>
    strokeWidth?: CompiledStyleExpression<number>
    opacity?: CompiledStyleExpression<number>
  }
  symbol?: {
    textField?: CompiledStyleExpression<string>
    textSize?: CompiledStyleExpression<number>
    textColor?: CompiledStyleExpression<Color>
    textHaloColor?: CompiledStyleExpression<Color>
    textHaloWidth?: CompiledStyleExpression<number>
    textOpacity?: CompiledStyleExpression<number>
    textFont?: CompiledStyleExpression<string[]>
    textAnchor?: CompiledStyleExpression<string>
    textOffset?: CompiledStyleExpression<[number, number]>
    iconImage?: CompiledStyleExpression<string>
    iconColor?: CompiledStyleExpression<Color>
    iconOpacity?: CompiledStyleExpression<number>
    iconSize?: CompiledStyleExpression<number>
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
const layoutSymbolSpec = latest['layout_symbol']

const backgroundStyleFeature: DecodedFeatureRecord = {
  id: undefined,
  type: 'Unknown',
  bbox: [0, 0, 0, 0],
  properties: {},
  geometry: [],
}

function toMapLibreFeature(feature: DecodedFeatureRecord): StyleFeature {
  return {
    type: feature.type,
    id: feature.id,
    properties: feature.properties,
    geometry: feature.geometry.map((part) =>
      part.map(([x, y]) => ({
        x,
        y,
      })),
    ),
  }
}

function toCesiumColor(value: unknown, fallback: Color): Color {
  if (value instanceof Color) {
    return Color.clone(value)
  }

  if (
    value &&
    typeof value === 'object' &&
    'r' in value &&
    'g' in value &&
    'b' in value
  ) {
    const color = value as { r: number; g: number; b: number; a?: number }
    return new Color(color.r, color.g, color.b, color.a ?? 1)
  }

  if (typeof value === 'string') {
    return Color.fromCssColorString(value)
  }

  return Color.clone(fallback)
}

function formatTextValue(value: unknown): string {
  if (value instanceof Formatted) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join('')
  }

  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
}

function compilePropertyExpression<T>(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: unknown,
  transform?: (input: unknown) => T,
): CompiledStyleExpression<T> | undefined {
  const input =
    value !== undefined
      ? value
      : fallback !== undefined
        ? fallback
        : spec.default !== undefined
          ? spec.default
          : undefined

  const normalizedInput =
    Array.isArray(input) && !isExpression(input)
      ? ['literal', input]
      : input

  if (normalizedInput === undefined) {
    return undefined
  }

  const compiled = createPropertyExpression(normalizedInput, spec)
  if (compiled.result === 'error') {
    throw new Error(compiled.value.map((issue) => issue.message).join('; '))
  }

  return {
    evaluate(feature: DecodedFeatureRecord, zoom: number): T {
      const evaluated = compiled.value.evaluate(
        { zoom },
        toMapLibreFeature(feature),
        {},
      )
      return transform ? transform(evaluated) : (evaluated as T)
    },
  }
}

function compileColorExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback: string,
): CompiledStyleExpression<Color> | undefined {
  return compilePropertyExpression<Color>(
    value,
    spec,
    fallback,
    (input) => toCesiumColor(input, Color.fromCssColorString(fallback)),
  )
}

function compileNumberExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: number,
): CompiledStyleExpression<number> | undefined {
  return compilePropertyExpression<number>(value, spec, fallback, (input) => {
    const numberValue = Number(input)
    return Number.isFinite(numberValue) ? numberValue : fallback ?? 0
  })
}

function compileStringExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: string,
): CompiledStyleExpression<string> | undefined {
  return compilePropertyExpression<string>(value, spec, fallback, (input) =>
    formatTextValue(input),
  )
}

function compileFontExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: string[],
): CompiledStyleExpression<string[]> | undefined {
  return compilePropertyExpression<string[]>(value, spec, fallback, (input) => {
    if (Array.isArray(input)) {
      return input.map((font) => String(font)).filter((font) => font.length > 0)
    }

    if (typeof input === 'string' && input.trim().length > 0) {
      return [input.trim()]
    }

    return fallback ?? []
  })
}

function compileTextAnchorExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<string> | undefined {
  return compileStringExpression(value, spec, 'center')
}

function compileTextOffsetExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<[number, number]> | undefined {
  return compilePropertyExpression<[number, number]>(
    value,
    spec,
    [0, 0],
    (input) => {
      if (!Array.isArray(input) || input.length < 2) {
        return [0, 0]
      }

      const x = Number(input[0])
      const y = Number(input[1])
      return [
        Number.isFinite(x) ? x : 0,
        Number.isFinite(y) ? y : 0,
      ]
    },
  )
}

function buildStyleFeatureFilter(layer: SupportedLayerSpecification) {
  const compiledFilter = featureFilter(layer.filter)

  return (feature: DecodedFeatureRecord, zoom: number): boolean =>
    compiledFilter.filter({ zoom }, toMapLibreFeature(feature), undefined)
}

function buildStyleLayerVisibility(layer: SupportedLayerSpecification) {
  return (
    decodedLayer: DecodedLayerRecord,
    _tile: DecodedTileRecord,
    zoom: number,
  ): boolean => {
    if (layer.minzoom !== undefined && zoom < layer.minzoom) {
      return false
    }

    if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) {
      return false
    }

    if (layer['source-layer'] && layer['source-layer'] !== decodedLayer.name) {
      return false
    }

    if (layer.layout && layer.layout.visibility === 'none') {
      return false
    }

    return decodedLayer.featureCount > 0
  }
}

function createCompiledLayer(layer: LayerSpecification): CompiledStyleLayer | undefined {
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
    }
  }

  if (layer.type === 'symbol') {
    compiled.symbol = {
      textField:
        supportedLayer.layout?.['text-field'] !== undefined
          ? compileStringExpression(
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
      textOpacity: compileNumberExpression(
        supportedLayer.paint?.['text-opacity'],
        paintSymbolSpec['text-opacity'],
        1,
      ),
      textFont:
        supportedLayer.layout?.['text-font'] !== undefined
          ? compileFontExpression(
              supportedLayer.layout['text-font'],
              layoutSymbolSpec['text-font'],
              ['sans-serif'],
            )
          : undefined,
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
      iconSize:
        supportedLayer.layout?.['icon-size'] !== undefined
          ? compileNumberExpression(
              supportedLayer.layout['icon-size'],
              layoutSymbolSpec['icon-size'],
              1,
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

  for (const layer of (style.layers ?? [])) {
    const compiled = createCompiledLayer(layer)
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
