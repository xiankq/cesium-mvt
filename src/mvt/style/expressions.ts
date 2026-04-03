import {
  createPropertyExpression,
  featureFilter,
  isExpression,
  Formatted,
  type Feature as MapLibreFeature,
  type StylePropertySpecification,
} from '@maplibre/maplibre-gl-style-spec'
import { Color } from 'cesium'
import {
  type DecodedFeatureRecord,
  type DecodedLayerRecord,
  type DecodedTileRecord,
} from '../types'

export type CompiledStyleExpression<T> = {
  evaluate(feature: DecodedFeatureRecord, zoom: number): T
}

export type ResolvedFormattedText = {
  text: string
  fontStack?: string[]
  textColor?: Color
}

type StyleFeature = MapLibreFeature

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
    const cesiumColor = Color.fromCssColorString(value)
    if (cesiumColor) {
      return cesiumColor
    }
  }

  return Color.clone(fallback)
}

export function resolveFormattedText(value: unknown): ResolvedFormattedText {
  if (value instanceof Formatted) {
    const text = value.sections.map((section) => section.text ?? '').join('')

    const fontStackSection = value.sections.find(
      (section) => typeof section.fontStack === 'string' && section.fontStack.trim().length > 0,
    )
    const textColorSection = value.sections.find((section) => section.textColor !== null && section.textColor !== undefined)

    return {
      text,
      fontStack: fontStackSection?.fontStack
        ?.split(',')
        .map((font) => font.trim())
        .filter((font) => font.length > 0),
      textColor: textColorSection ? toCesiumColor(textColorSection.textColor, Color.WHITE) : undefined,
    }
  }

  if (typeof value === 'string') {
    return {
      text: value,
    }
  }

  if (value === null || value === undefined) {
    return {
      text: '',
    }
  }

  return {
    text: String(value),
  }
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

export function compilePropertyExpression<T>(
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

export function compileColorExpression(
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

export function compileNumberExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: number,
): CompiledStyleExpression<number> | undefined {
  return compilePropertyExpression<number>(value, spec, fallback, (input) => {
    const numberValue = Number(input)
    return Number.isFinite(numberValue) ? numberValue : fallback ?? 0
  })
}

export function compileBooleanExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: boolean,
): CompiledStyleExpression<boolean> | undefined {
  return compilePropertyExpression<boolean>(value, spec, fallback, (input) =>
    Boolean(input),
  )
}

export function compileEnumExpression<T extends string>(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: T,
): CompiledStyleExpression<T> | undefined {
  return compileStringExpression(value, spec, fallback) as
    | CompiledStyleExpression<T>
    | undefined
}

export function compileStringExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback?: string,
): CompiledStyleExpression<string> | undefined {
  return compilePropertyExpression<string>(value, spec, fallback, (input) =>
    formatTextValue(input),
  )
}

export function compileFontExpression(
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

export function compileTextAnchorExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<string> | undefined {
  return compileStringExpression(value, spec, 'center')
}

export function compileTextOffsetExpression(
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

export function compileTextOverlapExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<'never' | 'always' | 'cooperative'> | undefined {
  return compileStringExpression(value, spec, 'never') as
    | CompiledStyleExpression<'never' | 'always' | 'cooperative'>
    | undefined
}

export function compileNumberTupleExpression(
  value: unknown,
  spec: StylePropertySpecification,
  fallback: [number, number, number, number],
): CompiledStyleExpression<[number, number, number, number]> | undefined {
  return compilePropertyExpression<[number, number, number, number]>(
    value,
    spec,
    fallback,
    (input) => {
      if (!Array.isArray(input) || input.length < 4) {
        return fallback
      }

      return [
        Number(input[0]) || 0,
        Number(input[1]) || 0,
        Number(input[2]) || 0,
        Number(input[3]) || 0,
      ]
    },
  )
}

export function compileTextTransformExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<'none' | 'uppercase' | 'lowercase'> | undefined {
  return compileEnumExpression<'none' | 'uppercase' | 'lowercase'>(
    value,
    spec,
    'none',
  )
}

export function compileTextJustifyExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<'auto' | 'left' | 'center' | 'right'> | undefined {
  return compileEnumExpression<'auto' | 'left' | 'center' | 'right'>(
    value,
    spec,
    'auto',
  )
}

export function compileTextTranslateAnchorExpression(
  value: unknown,
  spec: StylePropertySpecification,
): CompiledStyleExpression<'map' | 'viewport'> | undefined {
  return compileEnumExpression<'map' | 'viewport'>(value, spec, 'map')
}

export function buildStyleFeatureFilter(layer: {
  filter?: unknown
}) {
  const compiledFilter = featureFilter(layer.filter as never)

  return (feature: DecodedFeatureRecord, zoom: number): boolean =>
    compiledFilter.filter({ zoom }, toMapLibreFeature(feature), undefined)
}

export function buildStyleLayerVisibility(layer: {
  minzoom?: number
  maxzoom?: number
  layout?: {
    visibility?: 'visible' | 'none'
    [key: string]: unknown
  }
  ['source-layer']?: string
}) {
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
