import { type Color } from 'cesium'
import murmurhash from 'murmurhash-js'
import { fontStackToCss, type SymbolPlacementCandidate } from './feature-preview-symbols'

export type TextSpriteLayout = {
  bucketKey: string
  entryKey: string
  text: string
  lines: string[]
  fontCss: string
  textAlign: CanvasTextAlign
  width: number
  height: number
  renderWidth: number
  renderHeight: number
  pixelRatio: number
}

export type TextSpriteImage = TextSpriteLayout & {
  image: HTMLCanvasElement
}

export type TextSpriteRequest = {
  text: string
  textAnchor: string
  textSize: number
  fontStack: string[]
  textColor: Color
  haloColor: Color
  haloWidth: number
  haloBlur: number
  textPadding: number
  textLineHeight: number
  textLetterSpacing: number
  textJustify: 'auto' | 'left' | 'center' | 'right'
  devicePixelRatio?: number
}

type TextAtlasEntry = TextSpriteImage

type TextAtlasPagePlacement = {
  x: number
  y: number
  width: number
  height: number
}

type TextAtlasPage = {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  cursorX: number
  cursorY: number
  rowHeight: number
}

type TextAtlasBucket = {
  pageCssSize: number
  pixelRatio: number
  pages: TextAtlasPage[]
  entries: Map<string, TextAtlasEntry>
}

const DEFAULT_PAGE_CSS_SIZE = 1024
const DEFAULT_PADDING = 2
const DEFAULT_BACKGROUND_MARGIN = 2

function colorToCss(color: Color): string {
  return color.toCssColorString()
}

function normalizeAtlasText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim()
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width))
  canvas.height = Math.max(1, Math.ceil(height))
  return canvas
}

function createPageCanvas(
  width: number,
  height: number,
  pixelRatio: number,
): TextAtlasPage {
  const canvas = createCanvas(width * pixelRatio, height * pixelRatio)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to acquire a 2D canvas context for text atlas.')
  }

  context.scale(pixelRatio, pixelRatio)
  context.textBaseline = 'alphabetic'
  context.lineJoin = 'round'
  context.lineCap = 'round'

  return {
    canvas,
    context,
    cursorX: 0,
    cursorY: 0,
    rowHeight: 0,
  }
}

function measureLineWidth(
  context: CanvasRenderingContext2D,
  line: string,
  textSize: number,
  letterSpacing: number,
): number {
  if (line.length === 0) {
    return 0
  }

  if (letterSpacing === 0) {
    return context.measureText(line).width
  }

  const spacing = letterSpacing * textSize
  let width = 0
  let index = 0

  for (const character of line) {
    width += context.measureText(character).width
    if (index < line.length - 1) {
      width += spacing
    }
    index += 1
  }

  return width
}

function resolveTextAlign(
  justify: 'auto' | 'left' | 'center' | 'right',
  anchor: string,
): CanvasTextAlign {
  switch (justify) {
    case 'left':
      return 'left'
    case 'right':
      return 'right'
    case 'center':
      return 'center'
    default:
      if (anchor.includes('left')) {
        return 'left'
      }
      if (anchor.includes('right')) {
        return 'right'
      }
      return 'center'
  }
}

function measureTextLayout(
  request: TextSpriteRequest,
): Omit<TextSpriteLayout, 'bucketKey' | 'entryKey'> {
  const scale = Number.isFinite(request.devicePixelRatio) && (request.devicePixelRatio ?? 0) > 0
    ? Math.max(1, request.devicePixelRatio ?? 1)
    : Math.max(1, globalThis.devicePixelRatio ?? 1)

  const text = normalizeAtlasText(request.text)
  const lines = text.length > 0 ? text.split(/\r?\n/) : ['']
  const fontCss = `${request.textSize}px ${fontStackToCss(request.fontStack)}`
  const canvas = createCanvas(1, 1)
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to acquire a 2D canvas context for text measurement.')
  }

  context.font = fontCss

  const metrics = context.measureText('Mg')
  const ascent = Math.max(
    1,
    Math.ceil(metrics.actualBoundingBoxAscent || request.textSize * 0.8),
  )
  const descent = Math.max(
    1,
    Math.ceil(metrics.actualBoundingBoxDescent || request.textSize * 0.2),
  )
  const lineHeightCss = Math.max(
    request.textSize,
    Math.ceil(request.textSize * request.textLineHeight),
    ascent + descent,
  )

  let maxLineWidth = 0
  for (const line of lines) {
    maxLineWidth = Math.max(
      maxLineWidth,
      measureLineWidth(context, line, request.textSize, request.textLetterSpacing),
    )
  }

  const haloSpread = Math.max(0, request.haloWidth) + Math.max(0, request.haloBlur)
  const padding = Math.max(
    DEFAULT_PADDING,
    Math.max(0, request.textPadding) + haloSpread + DEFAULT_BACKGROUND_MARGIN,
  )

  const width = Math.max(1, Math.ceil(maxLineWidth + padding * 2))
  const height = Math.max(1, Math.ceil(lines.length * lineHeightCss + padding * 2))
  const renderWidth = Math.max(1, Math.ceil(width * scale))
  const renderHeight = Math.max(1, Math.ceil(height * scale))

  return {
    text,
    lines,
    fontCss,
    textAlign: resolveTextAlign(request.textJustify, request.textAnchor),
    width,
    height,
    renderWidth,
    renderHeight,
    pixelRatio: scale,
  }
}

function getBucketKey(request: TextSpriteRequest): string {
  return [
    fontStackToCss(request.fontStack),
    request.textSize,
    colorToCss(request.textColor),
    colorToCss(request.haloColor),
    request.haloWidth,
    request.haloBlur,
    request.textPadding,
    request.textLineHeight,
    request.textLetterSpacing,
    request.textJustify,
    Math.max(1, request.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1),
  ].join('|')
}

function getEntryKey(
  bucketKey: string,
  text: string,
  textAlign: CanvasTextAlign,
): string {
  const textKey = normalizeAtlasText(text)
  const textHash = murmurhash(`${textAlign}:${textKey}`).toString(36)
  return `${bucketKey}:${textHash}:${textKey}`
}

function allocatePlacement(
  page: TextAtlasPage,
  layout: TextSpriteLayout,
  pageCssSize: number,
): TextAtlasPagePlacement | undefined {
  const width = Math.max(1, Math.ceil(layout.renderWidth / layout.pixelRatio))
  const height = Math.max(1, Math.ceil(layout.renderHeight / layout.pixelRatio))
  const gutter = 2
  const limit = pageCssSize

  if (width > limit || height > limit) {
    return undefined
  }

  if (page.cursorX + width > limit) {
    page.cursorX = 0
    page.cursorY += page.rowHeight + gutter
    page.rowHeight = 0
  }

  if (page.cursorY + height > limit) {
    return undefined
  }

  const placement = {
    x: page.cursorX,
    y: page.cursorY,
    width,
    height,
  }

  page.cursorX += width + gutter
  page.rowHeight = Math.max(page.rowHeight, height)

  return placement
}

function drawTextBlock(
  page: TextAtlasPage,
  placement: TextAtlasPagePlacement,
  layout: TextSpriteLayout,
  request: TextSpriteRequest,
): void {
  const { context } = page
  const textSize = request.textSize
  const haloSpread = Math.max(0, request.haloWidth) + Math.max(0, request.haloBlur)
  const padding = Math.max(
    DEFAULT_PADDING,
    Math.max(0, request.textPadding) + haloSpread + DEFAULT_BACKGROUND_MARGIN,
  )
  const x = placement.x
  const y = placement.y
  const width = placement.width
  const height = placement.height
  const lineHeightCss = Math.max(
    textSize,
    Math.ceil(textSize * request.textLineHeight),
  )
  const metrics = context.measureText('Mg')
  const ascent = Math.max(
    1,
    Math.ceil(metrics.actualBoundingBoxAscent || textSize * 0.8),
  )
  const baselineY = padding + ascent

  context.save()
  context.clearRect(x, y, width, height)
  context.font = layout.fontCss
  context.fillStyle = colorToCss(request.textColor)
  context.textAlign = layout.textAlign
  context.lineWidth = Math.max(1, request.haloWidth + request.haloBlur)
  context.strokeStyle = colorToCss(request.haloColor)
  context.shadowColor = colorToCss(request.haloColor)
  context.shadowBlur = Math.max(0, request.haloBlur)

  const lineX =
    layout.textAlign === 'left'
      ? x + padding
      : layout.textAlign === 'right'
        ? x + width - padding
        : x + width / 2

  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex += 1) {
    const line = layout.lines[lineIndex] ?? ''
    const lineY = y + baselineY + lineIndex * lineHeightCss

    if (request.haloWidth > 0 || request.haloBlur > 0) {
      context.strokeText(line, lineX, lineY)
    }

    context.shadowBlur = 0
    context.fillText(line, lineX, lineY)
  }

  context.restore()
}

function cropTextEntry(
  page: TextAtlasPage,
  placement: TextAtlasPagePlacement,
  layout: TextSpriteLayout,
): HTMLCanvasElement {
  const crop = createCanvas(layout.renderWidth, layout.renderHeight)
  const context = crop.getContext('2d')

  if (!context) {
    throw new Error('Unable to acquire a 2D canvas context for text crop.')
  }

  context.drawImage(
    page.canvas,
    placement.x * layout.pixelRatio,
    placement.y * layout.pixelRatio,
    layout.renderWidth,
    layout.renderHeight,
    0,
    0,
    layout.renderWidth,
    layout.renderHeight,
  )

  return crop
}

function createBucket(pageCssSize: number, pixelRatio: number): TextAtlasBucket {
  return {
    pageCssSize,
    pixelRatio,
    pages: [],
    entries: new Map<string, TextAtlasEntry>(),
  }
}

function getOrCreatePage(bucket: TextAtlasBucket): TextAtlasPage {
  const lastPage = bucket.pages[bucket.pages.length - 1]
  if (lastPage) {
    return lastPage
  }

  const page = createPageCanvas(bucket.pageCssSize, bucket.pageCssSize, bucket.pixelRatio)
  bucket.pages.push(page)
  return page
}

export class TextSpriteAtlas {
  private readonly pageCssSize: number
  private readonly bucketMap = new Map<string, TextAtlasBucket>()
  private readonly layoutCache = new Map<string, TextSpriteLayout>()

  constructor(pageCssSize = DEFAULT_PAGE_CSS_SIZE) {
    this.pageCssSize = Math.max(256, pageCssSize)
  }

  clear(): void {
    this.bucketMap.clear()
    this.layoutCache.clear()
  }

  destroy(): void {
    this.clear()
  }

  measure(request: TextSpriteRequest): TextSpriteLayout | undefined {
    const normalizedText = normalizeAtlasText(request.text)
    if (normalizedText.length === 0) {
      return undefined
    }

    const bucketKey = getBucketKey(request)
    const measured = measureTextLayout({
      ...request,
      text: normalizedText,
    })

    const entryKey = getEntryKey(bucketKey, measured.text, measured.textAlign)
    const cached = this.layoutCache.get(entryKey)
    if (cached) {
      return cached
    }

    const layout: TextSpriteLayout = {
      bucketKey,
      entryKey,
      ...measured,
    }

    this.layoutCache.set(entryKey, layout)
    return layout
  }

  resolveImage(request: TextSpriteRequest): TextSpriteImage | undefined {
    const layout = this.measure(request)
    if (!layout) {
      return undefined
    }

    const bucket = this.getBucket(layout.bucketKey, layout.pixelRatio)
    const cached = bucket.entries.get(layout.entryKey)
    if (cached) {
      return cached
    }

    const page = getOrCreatePage(bucket)
    let placement = allocatePlacement(page, layout, bucket.pageCssSize)
    if (!placement) {
      const nextPage = createPageCanvas(bucket.pageCssSize, bucket.pageCssSize, bucket.pixelRatio)
      bucket.pages.push(nextPage)
      placement = allocatePlacement(nextPage, layout, bucket.pageCssSize)
      if (!placement) {
        return undefined
      }

      drawTextBlock(nextPage, placement, layout, request)
      const image = cropTextEntry(nextPage, placement, layout)
      const entry: TextAtlasEntry = {
        ...layout,
        image,
      }
      bucket.entries.set(layout.entryKey, entry)
      return entry
    }

    drawTextBlock(page, placement, layout, request)
    const image = cropTextEntry(page, placement, layout)
    const entry: TextAtlasEntry = {
      ...layout,
      image,
    }
    bucket.entries.set(layout.entryKey, entry)
    return entry
  }

  private getBucket(bucketKey: string, pixelRatio: number): TextAtlasBucket {
    const existing = this.bucketMap.get(bucketKey)
    if (existing) {
      return existing
    }

    const created = createBucket(this.pageCssSize, pixelRatio)
    this.bucketMap.set(bucketKey, created)
    return created
  }
}

export function buildTextSpriteRequest(
  candidate: SymbolPlacementCandidate,
  text: string,
  textAnchor: string,
  devicePixelRatio = globalThis.devicePixelRatio ?? 1,
): TextSpriteRequest {
  return {
    text,
    textAnchor,
    textSize: candidate.textSize,
    fontStack: candidate.fontStack,
    textColor: candidate.textColor,
    haloColor: candidate.haloColor,
    haloWidth: candidate.haloWidth,
    haloBlur: candidate.haloBlur,
    textPadding: candidate.textPadding,
    textLineHeight: candidate.textLineHeight,
    textLetterSpacing: candidate.textLetterSpacing,
    textJustify: candidate.textJustify,
    devicePixelRatio,
  }
}
