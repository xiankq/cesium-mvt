import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  HorizontalOrigin,
  Scene,
  VerticalOrigin,
} from 'cesium'
import type { ScreenRect } from './screen-space'
import type { SpriteAtlasEntry } from './sprite-atlas'

export type SymbolPlacementCandidate = {
  labelId: string
  featureId: number | string | undefined
  sourceIndex: number
  position: Cartesian3
  text?: string
  textKey?: string
  textSize: number
  fontStack: string[]
  textColor: Color
  haloColor: Color
  haloWidth: number
  haloBlur: number
  pixelOffset: Cartesian2
  horizontalOrigin: HorizontalOrigin
  verticalOrigin: VerticalOrigin
  textAnchor: string
  textVariableAnchors: string[]
  textPadding: number
  textLineHeight: number
  textLetterSpacing: number
  textMaxWidth: number
  textJustify: 'auto' | 'left' | 'center' | 'right'
  textTransform: 'none' | 'uppercase' | 'lowercase'
  textTranslate: Cartesian2
  textTranslateAnchor: 'map' | 'viewport'
  textRadialOffset: number
  allowOverlap: boolean
  ignorePlacement: boolean
  overlapMode: 'never' | 'always' | 'cooperative'
  optional: boolean
  symbolZOrder: 'auto' | 'viewport-y' | 'source'
  sortKey: number
  iconImageName?: string
  iconSize: number
  iconColor: Color
  iconOpacity: number
  iconHaloColor: Color
  iconHaloWidth: number
  iconHaloBlur: number
  iconAnchor: string
  iconVerticalOrigin: VerticalOrigin
  iconOffset: Cartesian2
  iconTranslate: Cartesian2
  iconTranslateAnchor: 'map' | 'viewport'
  iconPadding: number
  iconTextFit?: 'none' | 'width' | 'height' | 'both'
  iconTextFitPadding: [number, number, number, number]
  iconAllowOverlap: boolean
  iconIgnorePlacement: boolean
  iconOverlapMode: 'never' | 'always' | 'cooperative'
  iconOptional: boolean
  iconRotate: number
}

export type StyledSymbolPlacement = {
  tileId: string
  tileLevel: number
  bucketKey: string
  bucketOrder: number
  compiledId: string
  candidate: SymbolPlacementCandidate
}

export type SymbolBucketRuntime = {
  tileId: string
  bucketKey: string
  order: number
  textBillboardCollection?: BillboardCollection
  iconBillboardCollection?: BillboardCollection
  setLabelsVisible: (visible: boolean) => void
  destroy: () => void
}

type SymbolScreenRect = ScreenRect

export const DEFAULT_TEXT_FONT_STACK = ['Open Sans Regular', 'Arial Unicode MS Regular']
const scratchCanvasPosition = new Cartesian2()

export function parseTextAnchor(anchor: string): {
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
    case 'center':
      return {
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
      }
    default:
      return {
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
      }
  }
}

export function resolveTextJustifyOrigin(
  anchor: string,
  justify: 'auto' | 'left' | 'center' | 'right',
): HorizontalOrigin {
  switch (justify) {
    case 'left':
      return HorizontalOrigin.LEFT
    case 'right':
      return HorizontalOrigin.RIGHT
    case 'center':
      return HorizontalOrigin.CENTER
    default:
      return parseTextAnchor(anchor).horizontalOrigin
  }
}

export function applyTextTransform(
  text: string,
  transform: 'none' | 'uppercase' | 'lowercase',
): string {
  switch (transform) {
    case 'uppercase':
      return text.toLocaleUpperCase()
    case 'lowercase':
      return text.toLocaleLowerCase()
    default:
      return text
  }
}

export function wrapSymbolText(
  text: string,
  maxWidthEm: number,
  textSize: number,
  letterSpacing = 0,
): string {
  if (!Number.isFinite(maxWidthEm) || maxWidthEm <= 0) {
    return text
  }

  const maxLinePixels = maxWidthEm * textSize
  if (!Number.isFinite(maxLinePixels) || maxLinePixels <= 0) {
    return text
  }

  const estimatedGlyphWidth = Math.max(0.45, 0.56 + letterSpacing * 0.15) * textSize
  const maxChars = Math.max(1, Math.floor(maxLinePixels / estimatedGlyphWidth))
  if (maxChars <= 1) {
    return text
  }

  const paragraphs = text.replace(/\r\n/g, '\n').split('\n')
  const wrapped: string[] = []

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed.length === 0) {
      wrapped.push('')
      continue
    }

    const words = trimmed.split(/\s+/)
    if (words.length === 1 && words[0].length <= maxChars) {
      wrapped.push(words[0])
      continue
    }

    let line = ''
    for (const word of words) {
      if (word.length > maxChars) {
        if (line.length > 0) {
          wrapped.push(line)
          line = ''
        }

        let chunk = ''
        for (const character of word) {
          chunk += character
          if (chunk.length >= maxChars) {
            wrapped.push(chunk)
            chunk = ''
          }
        }

        if (chunk.length > 0) {
          line = chunk
        }
        continue
      }

      const candidate = line.length > 0 ? `${line} ${word}` : word
      if (candidate.length > maxChars && line.length > 0) {
        wrapped.push(line)
        line = word
      } else {
        line = candidate
      }
    }

    if (line.length > 0) {
      wrapped.push(line)
    }
  }

  return wrapped.join('\n')
}

export function textOffsetToPixelOffset(
  offset: [number, number] | undefined,
  textSize: number,
): Cartesian2 {
  if (!offset) {
    return new Cartesian2(0, 0)
  }

  return new Cartesian2(offset[0] * textSize, offset[1] * textSize)
}

export function combinePixelOffsets(
  base: Cartesian2,
  translate: Cartesian2 | undefined,
): Cartesian2 {
  if (!translate) {
    return Cartesian2.clone(base, new Cartesian2())
  }

  return Cartesian2.add(base, translate, new Cartesian2())
}

export function resolveTextPixelOffset(
  baseOffset: Cartesian2,
  translate: Cartesian2 | undefined,
  radialOffset: number,
  textSize: number,
  origins: {
    horizontalOrigin: HorizontalOrigin
    verticalOrigin: VerticalOrigin
  },
): Cartesian2 {
  const offset = Cartesian2.clone(baseOffset, new Cartesian2())

  if (translate) {
    offset.x += translate.x
    offset.y += translate.y
  }

  if (radialOffset !== 0) {
    const radius = radialOffset * textSize
    switch (origins.horizontalOrigin) {
      case HorizontalOrigin.LEFT:
        offset.x += radius
        break
      case HorizontalOrigin.RIGHT:
        offset.x -= radius
        break
      default:
        break
    }

    switch (origins.verticalOrigin) {
      case VerticalOrigin.TOP:
        offset.y += radius
        break
      case VerticalOrigin.BOTTOM:
        offset.y -= radius
        break
      default:
        break
    }
  }

  return offset
}

function estimateRectOrigin(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  origins: {
    horizontalOrigin: HorizontalOrigin
    verticalOrigin: VerticalOrigin
  },
): SymbolScreenRect {
  let left = offsetX
  let right = offsetX
  switch (origins.horizontalOrigin) {
    case HorizontalOrigin.LEFT:
      right = left + width
      break
    case HorizontalOrigin.RIGHT:
      left = right - width
      break
    default:
      left = offsetX - width / 2
      right = offsetX + width / 2
      break
  }

  let top = offsetY
  let bottom = offsetY
  switch (origins.verticalOrigin) {
    case VerticalOrigin.TOP:
      bottom = top + height
      break
    case VerticalOrigin.BOTTOM:
      top = bottom - height
      break
    default:
      top = offsetY - height / 2
      bottom = offsetY + height / 2
      break
  }

  return {
    left,
    top,
    right,
    bottom,
  }
}

export function estimateLabelScreenRect(
  scene: Scene,
  position: Cartesian3,
  text: string,
  textSize: number,
  padding: number,
  haloWidth: number,
  pixelOffset: Cartesian2,
  origins: {
    horizontalOrigin: HorizontalOrigin
    verticalOrigin: VerticalOrigin
  },
  lineHeight = 1.2,
  letterSpacing = 0,
): SymbolScreenRect | undefined {
  const canvasPosition = scene.cartesianToCanvasCoordinates(
    position,
    scratchCanvasPosition,
  )

  if (!canvasPosition) {
    return undefined
  }

  const offsetX = canvasPosition.x + pixelOffset.x
  const offsetY = canvasPosition.y - pixelOffset.y
  const lines = text.split(/\r?\n/)
  const longestLine = Math.max(
    1,
    ...lines.map((line) => line.trim().length),
  )
  const estimatedLineHeight = Math.max(1, textSize * lineHeight)
  const estimatedWidth = Math.max(
    textSize,
    longestLine * textSize * Math.max(0.5, 0.62 + letterSpacing * 0.15),
  )
  const estimatedHeight = Math.max(textSize, lines.length * estimatedLineHeight)
  const paddingPx = Math.max(0, padding) + Math.max(0, haloWidth) + 2
  const width = estimatedWidth + paddingPx * 2
  const height = estimatedHeight + paddingPx * 2

  return estimateRectOrigin(offsetX, offsetY, width, height, origins)
}

export function estimateIconScreenRect(
  scene: Scene,
  position: Cartesian3,
  width: number,
  height: number,
  pixelOffset: Cartesian2,
  origins: {
    horizontalOrigin: HorizontalOrigin
    verticalOrigin: VerticalOrigin
  },
  padding = 2,
): SymbolScreenRect | undefined {
  const canvasPosition = scene.cartesianToCanvasCoordinates(
    position,
    scratchCanvasPosition,
  )

  if (!canvasPosition) {
    return undefined
  }

  const offsetX = canvasPosition.x + pixelOffset.x
  const offsetY = canvasPosition.y - pixelOffset.y
  const paddedWidth = Math.max(1, width) + Math.max(0, padding) * 2
  const paddedHeight = Math.max(1, height) + Math.max(0, padding) * 2

  return estimateRectOrigin(offsetX, offsetY, paddedWidth, paddedHeight, origins)
}

export function estimateSpriteScreenRect(
  scene: Scene,
  position: Cartesian3,
  width: number,
  height: number,
  pixelOffset: Cartesian2,
  origins: {
    horizontalOrigin: HorizontalOrigin
    verticalOrigin: VerticalOrigin
  },
  padding = 2,
): SymbolScreenRect | undefined {
  const canvasPosition = scene.cartesianToCanvasCoordinates(
    position,
    scratchCanvasPosition,
  )

  if (!canvasPosition) {
    return undefined
  }

  const offsetX = canvasPosition.x + pixelOffset.x
  const offsetY = canvasPosition.y - pixelOffset.y
  const paddedWidth = Math.max(1, width) + Math.max(0, padding) * 2
  const paddedHeight = Math.max(1, height) + Math.max(0, padding) * 2

  return estimateRectOrigin(offsetX, offsetY, paddedWidth, paddedHeight, origins)
}

export function normalizeSymbolKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function formatSymbolPositionKey(
  position: Cartesian3,
  precisionMeters = 8,
): string {
  const precision = Math.max(1, precisionMeters)
  return [
    Math.round(position.x / precision),
    Math.round(position.y / precision),
    Math.round(position.z / precision),
  ].join(':')
}

export function buildSymbolDedupeKey(
  layerId: string,
  candidate: SymbolPlacementCandidate,
  text: string | undefined,
): string {
  const textKey = candidate.textKey ? normalizeSymbolKey(candidate.textKey) : text ? normalizeSymbolKey(text) : ''
  const iconKey = candidate.iconImageName ? candidate.iconImageName.trim() : ''
  const sourceKey = textKey.length > 0 ? textKey : iconKey
  const positionKey = formatSymbolPositionKey(candidate.position)
  return `${layerId}:${sourceKey}:${positionKey}`
}

export function unionScreenRects(
  a: SymbolScreenRect,
  b: SymbolScreenRect,
): SymbolScreenRect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }
}

export function resolveIconImageDimensions(
  spriteEntry: SpriteAtlasEntry,
  iconSize: number,
  textRect: SymbolScreenRect | undefined,
  iconTextFit: 'none' | 'width' | 'height' | 'both',
  iconTextFitPadding: [number, number, number, number],
): {
  width: number
  height: number
} {
  const intrinsicWidth = Math.max(
    1,
    (spriteEntry.width / Math.max(1, spriteEntry.pixelRatio)) * Math.max(0.1, iconSize),
  )
  const intrinsicHeight = Math.max(
    1,
    (spriteEntry.height / Math.max(1, spriteEntry.pixelRatio)) * Math.max(0.1, iconSize),
  )

  if (!textRect || iconTextFit === 'none') {
    return {
      width: intrinsicWidth,
      height: intrinsicHeight,
    }
  }

  const textWidth = Math.max(1, Math.abs(textRect.right - textRect.left))
  const textHeight = Math.max(1, Math.abs(textRect.bottom - textRect.top))
  const targetWidth = textWidth + Math.max(0, iconTextFitPadding[3]) + Math.max(0, iconTextFitPadding[1])
  const targetHeight = textHeight + Math.max(0, iconTextFitPadding[0]) + Math.max(0, iconTextFitPadding[2])

  switch (iconTextFit) {
    case 'width':
      return {
        width: targetWidth,
        height: intrinsicHeight * (targetWidth / intrinsicWidth),
      }
    case 'height':
      return {
        width: intrinsicWidth * (targetHeight / intrinsicHeight),
        height: targetHeight,
      }
    case 'both':
      return {
        width: targetWidth,
        height: targetHeight,
      }
    default:
      return {
        width: intrinsicWidth,
        height: intrinsicHeight,
      }
  }
}

export function fontStackToCss(
  fontStack: unknown,
  fallback = DEFAULT_TEXT_FONT_STACK.join(', '),
): string {
  if (Array.isArray(fontStack)) {
    const names = fontStack
      .map((font) => String(font).trim())
      .filter((font) => font.length > 0)
    if (names.length > 0) {
      return names
        .map((font) =>
          /[,"\s]/.test(font) ? `"${font.replace(/"/g, '\\"')}"` : font,
        )
        .join(', ')
    }
  }

  if (typeof fontStack === 'string' && fontStack.trim().length > 0) {
    return fontStack.trim()
  }

  return fallback
}
