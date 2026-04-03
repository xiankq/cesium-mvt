import { Rectangle } from 'cesium'
import type { UrlTemplateContext } from '../types'

function toDegrees(radians: number): string {
  return String((radians * 180) / Math.PI)
}

function normalizeSubdomains(subdomains?: string | string[]): string[] {
  if (Array.isArray(subdomains)) return subdomains.slice()
  if (typeof subdomains === 'string' && subdomains.length > 0) {
    return subdomains.split('')
  }
  return ['a', 'b', 'c']
}

function resolvePadding(
  urlSchemeZeroPadding: Record<string, string> | undefined,
  token: string,
): number | undefined {
  const padding = urlSchemeZeroPadding?.[token]
  return padding ? padding.length : undefined
}

function padValue(
  value: number,
  token: string,
  urlSchemeZeroPadding: Record<string, string> | undefined,
): string {
  const padding = resolvePadding(urlSchemeZeroPadding, token)
  if (!padding) return String(value)

  return String(value).padStart(padding, '0')
}

function selectSubdomain(subdomains: string[], x: number, y: number, level: number) {
  if (subdomains.length === 0) return ''
  const index = Math.abs(x + y + level) % subdomains.length
  return subdomains[index]
}

function replaceTokens(template: string, context: UrlTemplateContext): string {
  const tilesX = context.tilingScheme.getNumberOfXTilesAtLevel(context.level)
  const tilesY = context.tilingScheme.getNumberOfYTilesAtLevel(context.level)

  const replacements: Record<string, string> = {
    z: padValue(context.level, '{z}', context.urlSchemeZeroPadding),
    x: padValue(context.x, '{x}', context.urlSchemeZeroPadding),
    y: padValue(context.y, '{y}', context.urlSchemeZeroPadding),
    reverseX: padValue(
      tilesX - context.x - 1,
      '{reverseX}',
      context.urlSchemeZeroPadding,
    ),
    reverseY: padValue(
      tilesY - context.y - 1,
      '{reverseY}',
      context.urlSchemeZeroPadding,
    ),
    reverseZ: padValue(
      context.maximumLevel !== undefined ? context.maximumLevel - context.level : context.level,
      '{reverseZ}',
      context.urlSchemeZeroPadding,
    ),
    westDegrees: toDegrees(context.rectangle.west),
    southDegrees: toDegrees(context.rectangle.south),
    eastDegrees: toDegrees(context.rectangle.east),
    northDegrees: toDegrees(context.rectangle.north),
    westProjected: String(context.nativeRectangle.west),
    southProjected: String(context.nativeRectangle.south),
    eastProjected: String(context.nativeRectangle.east),
    northProjected: String(context.nativeRectangle.north),
    width: String(context.tileWidth),
    height: String(context.tileHeight),
    s: selectSubdomain(context.subdomains, context.x, context.y, context.level),
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, rawName: string) => {
    const token = String(rawName)

    if (context.customTags?.[token]) {
      return context.customTags[token](context)
    }

    const replacement = replacements[token]
    return replacement ?? match
  })
}

export function buildTileUrl(
  template: string,
  context: Omit<UrlTemplateContext, 'rectangle' | 'nativeRectangle' | 'subdomains'> & {
    subdomains?: string | string[]
  },
): string {
  const rectangle = context.tilingScheme.tileXYToRectangle(context.x, context.y, context.level)
  const nativeRectangle = context.tilingScheme.rectangleToNativeRectangle(
    Rectangle.clone(rectangle),
  )

  return replaceTokens(template, {
    ...context,
    rectangle,
    nativeRectangle,
    subdomains: normalizeSubdomains(context.subdomains),
  })
}
