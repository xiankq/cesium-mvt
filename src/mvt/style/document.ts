import {
  format as formatStyle,
  migrate as migrateStyle,
  validateStyleMin,
  type SourceSpecification,
  type SpriteSpecification,
  type StyleSpecification,
  type ValidationError,
  type VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec'

export type MapLibreStyleDocument = StyleSpecification

export type MapLibreStyleIssue = {
  message: string
  identifier: string
  line: number
}

export type MapLibreStyleSummary = {
  title: string
  layerCount: number
  sourceCount: number
  vectorSourceNames: string[]
  spriteUrl?: SpriteSpecification
  glyphsUrl?: string
}

export type MapLibreSourceDescriptor = {
  name: string
  source: SourceSpecification
}

export type MapLibreVectorSourceDescriptor = {
  name: string
  source: VectorSourceSpecification
  tiles: string[]
  url?: string
  minzoom?: number
  maxzoom?: number
  bounds?: VectorSourceSpecification['bounds']
  scheme?: VectorSourceSpecification['scheme']
  promoteId?: VectorSourceSpecification['promoteId']
}

export class MapLibreStyleValidationError extends Error {
  readonly issues: MapLibreStyleIssue[]

  constructor(issues: MapLibreStyleIssue[]) {
    super(issues.map((issue) => issue.message).join('; '))
    this.name = 'MapLibreStyleValidationError'
    this.issues = issues
  }
}

function cloneStyleDocument(style: StyleSpecification): StyleSpecification {
  return JSON.parse(JSON.stringify(style)) as StyleSpecification
}

function toStyleIssues(errors: ValidationError[]): MapLibreStyleIssue[] {
  return errors.map((error) => ({
    message: error.message,
    identifier: error.identifier,
    line: error.line,
  }))
}

function isVectorSource(source: SourceSpecification): source is VectorSourceSpecification {
  return source.type === 'vector'
}

export function validateMapLibreStyle(
  style: StyleSpecification | string,
): MapLibreStyleIssue[] {
  return toStyleIssues(validateStyleMin(style as never))
}

export function normalizeMapLibreStyle(style: StyleSpecification): StyleSpecification {
  const cloned = cloneStyleDocument(style)
  const migrated = cloned.version === 8 ? cloned : migrateStyle(cloned)
  const issues = validateMapLibreStyle(migrated)

  if (issues.length > 0) {
    throw new MapLibreStyleValidationError(issues)
  }

  return migrated
}

export function formatMapLibreStyle(style: StyleSpecification, space = 2): string {
  return formatStyle(cloneStyleDocument(style), space)
}

export function summarizeMapLibreStyle(style: StyleSpecification): MapLibreStyleSummary {
  const sourceEntries = Object.entries(style.sources ?? {})
  const vectorSourceNames = sourceEntries
    .filter(([, source]) => isVectorSource(source))
    .map(([name]) => name)

  return {
    title: style.name ?? vectorSourceNames[0] ?? 'style',
    layerCount: style.layers?.length ?? 0,
    sourceCount: sourceEntries.length,
    vectorSourceNames,
    spriteUrl: style.sprite,
    glyphsUrl: style.glyphs,
  }
}

export function listMapLibreSources(style: StyleSpecification): MapLibreSourceDescriptor[] {
  return Object.entries(style.sources ?? {}).map(([name, source]) => ({
    name,
    source,
  }))
}

export function listMapLibreVectorSources(
  style: StyleSpecification,
): MapLibreVectorSourceDescriptor[] {
  const sources = style.sources ?? {}
  const entries = Object.entries(sources)

  return entries.flatMap(([name, source]) => {
    if (!isVectorSource(source)) {
      return []
    }

    return [
      {
        name,
        source,
        tiles: source.tiles ?? [],
        url: source.url,
        minzoom: source.minzoom,
        maxzoom: source.maxzoom,
        bounds: source.bounds,
        scheme: source.scheme,
        promoteId: source.promoteId,
      },
    ]
  })
}

export function resolveMapLibreSource(
  style: StyleSpecification,
  preferredSourceName?: string,
): MapLibreSourceDescriptor {
  const sources = style.sources ?? {}

  if (preferredSourceName) {
    const preferred = sources[preferredSourceName]
    if (!preferred) {
      throw new Error(
        `Style source "${preferredSourceName}" was not found in ${style.name ?? 'style'}.`,
      )
    }

    return {
      name: preferredSourceName,
      source: preferred,
    }
  }

  for (const [name, source] of Object.entries(sources)) {
    return {
      name,
      source,
    }
  }

  throw new Error(`No source was found in ${style.name ?? 'style'}.`)
}

export function resolveMapLibreVectorSource(
  style: StyleSpecification,
  preferredSourceName?: string,
): MapLibreVectorSourceDescriptor {
  const sources = style.sources ?? {}

  if (preferredSourceName) {
    const descriptor = resolveMapLibreSource(style, preferredSourceName)
    if (!isVectorSource(descriptor.source)) {
      throw new Error(`Style source "${descriptor.name}" is not a vector source.`)
    }

    const source = descriptor.source
    return {
      name: descriptor.name,
      source,
      tiles: source.tiles ?? [],
      url: source.url,
      minzoom: source.minzoom,
      maxzoom: source.maxzoom,
      bounds: source.bounds,
      scheme: source.scheme,
      promoteId: source.promoteId,
    }
  }

  for (const [name, source] of Object.entries(sources)) {
    if (!isVectorSource(source)) {
      continue
    }

    return {
      name,
      source,
      tiles: source.tiles ?? [],
      url: source.url,
      minzoom: source.minzoom,
      maxzoom: source.maxzoom,
      bounds: source.bounds,
      scheme: source.scheme,
      promoteId: source.promoteId,
    }
  }

  throw new Error(`No vector source was found in ${style.name ?? 'style'}.`)
}
