import type { BillboardCollection, Cartesian3, Color, LabelCollection, Scene } from 'cesium';
import type { ScreenRect } from '../utils/screen-space';
import type { SpriteAtlasEntry } from './sprite';
import { Cartesian2, HorizontalOrigin, VerticalOrigin } from 'cesium';

export interface SymbolPlacementCandidate {
  labelId: string;
  featureId: number | string | undefined;
  sourceIndex: number;
  position: Cartesian3;
  text?: string;
  textKey?: string;
  textSize: number;
  fontStack: string[];
  textColor: Color;
  haloColor: Color;
  haloWidth: number;
  haloBlur: number;
  pixelOffset: Cartesian2;
  textAnchor: string;
  textVariableAnchors: string[];
  textPadding: number;
  textLineHeight: number;
  textLetterSpacing: number;
  textJustify: 'auto' | 'left' | 'center' | 'right';
  textTranslate: Cartesian2;
  textRadialOffset: number;
  ignorePlacement: boolean;
  overlapMode: 'never' | 'always' | 'cooperative';
  optional: boolean;
  symbolZOrder: 'auto' | 'viewport-y' | 'source';
  sortKey: number;
  iconImageName?: string;
  iconSize: number;
  iconColor: Color;
  iconOpacity: number;
  iconHaloColor: Color;
  iconHaloWidth: number;
  iconHaloBlur: number;
  iconAnchor: string;
  iconVerticalOrigin: VerticalOrigin;
  iconOffset: Cartesian2;
  iconTranslate: Cartesian2;
  iconPadding: number;
  iconTextFit?: 'none' | 'width' | 'height' | 'both';
  iconTextFitPadding: [number, number, number, number];
  iconIgnorePlacement: boolean;
  iconOverlapMode: 'never' | 'always' | 'cooperative';
  iconOptional: boolean;
  iconRotate: number;
}

export interface StyledSymbolPlacement {
  tileId: string;
  tileLevel: number;
  bucketKey: string;
  bucketOrder: number;
  compiledId: string;
  candidate: SymbolPlacementCandidate;
}

export interface SymbolBucketRuntime {
  tileId: string;
  bucketKey: string;
  order: number;
  textLabelCollection?: LabelCollection;
  iconBillboardCollection?: BillboardCollection;
  setLabelsVisible: (visible: boolean) => void;
  destroy: () => void;
}

type SymbolScreenRect = ScreenRect;
interface TextAnchorOrigin {
  horizontalOrigin: HorizontalOrigin;
  verticalOrigin: VerticalOrigin;
}
type TextJustify = SymbolPlacementCandidate['textJustify'];
type TextTransform = 'none' | 'uppercase' | 'lowercase';
type IconTextFit = NonNullable<SymbolPlacementCandidate['iconTextFit']>;

export const DEFAULT_TEXT_FONT_STACK = ['Open Sans Regular', 'Arial Unicode MS Regular'];
const scratchCanvasPosition = new Cartesian2();
const DEFAULT_TEXT_ANCHOR_ORIGIN: TextAnchorOrigin = {
  horizontalOrigin: HorizontalOrigin.CENTER,
  verticalOrigin: VerticalOrigin.BOTTOM,
};
const TEXT_ANCHOR_ORIGINS: Record<string, TextAnchorOrigin> = {
  'left': {
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.CENTER,
  },
  'right': {
    horizontalOrigin: HorizontalOrigin.RIGHT,
    verticalOrigin: VerticalOrigin.CENTER,
  },
  'top': {
    horizontalOrigin: HorizontalOrigin.CENTER,
    verticalOrigin: VerticalOrigin.TOP,
  },
  'bottom': {
    horizontalOrigin: HorizontalOrigin.CENTER,
    verticalOrigin: VerticalOrigin.BOTTOM,
  },
  'top-left': {
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.TOP,
  },
  'top-right': {
    horizontalOrigin: HorizontalOrigin.RIGHT,
    verticalOrigin: VerticalOrigin.TOP,
  },
  'bottom-left': {
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.BOTTOM,
  },
  'bottom-right': {
    horizontalOrigin: HorizontalOrigin.RIGHT,
    verticalOrigin: VerticalOrigin.BOTTOM,
  },
  'center': DEFAULT_TEXT_ANCHOR_ORIGIN,
};
const TEXT_JUSTIFY_ORIGINS: Record<Exclude<TextJustify, 'auto'>, HorizontalOrigin> = {
  left: HorizontalOrigin.LEFT,
  center: HorizontalOrigin.CENTER,
  right: HorizontalOrigin.RIGHT,
};
const TEXT_TRANSFORMERS: Record<TextTransform, (text: string) => string> = {
  none: text => text,
  uppercase: text => text.toLocaleUpperCase(),
  lowercase: text => text.toLocaleLowerCase(),
};
const HORIZONTAL_ORIGIN_RADIAL_FACTORS: Partial<Record<HorizontalOrigin, number>> = {
  [HorizontalOrigin.LEFT]: 1,
  [HorizontalOrigin.RIGHT]: -1,
};
const VERTICAL_ORIGIN_RADIAL_FACTORS: Partial<Record<VerticalOrigin, number>> = {
  [VerticalOrigin.TOP]: 1,
  [VerticalOrigin.BOTTOM]: -1,
};
type IconDimensionResolver = (input: {
  intrinsicWidth: number;
  intrinsicHeight: number;
  targetWidth: number;
  targetHeight: number;
}) => {
  width: number;
  height: number;
};
const ICON_TEXT_FIT_DIMENSION_RESOLVERS: Record<
  Exclude<IconTextFit, 'none'>,
  IconDimensionResolver
> = {
  width: ({ intrinsicWidth, intrinsicHeight, targetWidth }) => ({
    width: targetWidth,
    height: intrinsicHeight * (targetWidth / intrinsicWidth),
  }),
  height: ({ intrinsicWidth, intrinsicHeight, targetHeight }) => ({
    width: intrinsicWidth * (targetHeight / intrinsicHeight),
    height: targetHeight,
  }),
  both: ({ targetWidth, targetHeight }) => ({
    width: targetWidth,
    height: targetHeight,
  }),
};

export function parseTextAnchor(anchor: string): {
  horizontalOrigin: HorizontalOrigin;
  verticalOrigin: VerticalOrigin;
} {
  return TEXT_ANCHOR_ORIGINS[anchor] ?? DEFAULT_TEXT_ANCHOR_ORIGIN;
}

export function resolveTextJustifyOrigin(
  anchor: string,
  justify: 'auto' | 'left' | 'center' | 'right',
): HorizontalOrigin {
  return TEXT_JUSTIFY_ORIGINS[justify as Exclude<TextJustify, 'auto'>]
    ?? parseTextAnchor(anchor).horizontalOrigin;
}

export function applyTextTransform(
  text: string,
  transform: 'none' | 'uppercase' | 'lowercase',
): string {
  return (TEXT_TRANSFORMERS[transform] ?? TEXT_TRANSFORMERS.none)(text);
}

function isWideCharacter(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined)
    return false;
  // CJK Unified Ideographs, CJK Extensions, CJK Radicals, Hangul, Hiragana, Katakana
  return (
    (code >= 0x2E80 && code <= 0x9FFF)
    || (code >= 0xAC00 && code <= 0xD7AF)
    || (code >= 0xF900 && code <= 0xFAFF)
    || (code >= 0xFE30 && code <= 0xFE6F)
    || (code >= 0xFF00 && code <= 0xFFEF)
    || (code >= 0x1F200 && code <= 0x1F2FF)
    || (code >= 0x20000 && code <= 0x2FA1F)
    || (code >= 0x3000 && code <= 0x303F)
  );
}

function estimateTextWidthPixels(
  text: string,
  latinWidth: number,
  letterSpacing: number,
): number {
  let width = 0;
  let index = 0;
  for (const ch of text) {
    width += isWideCharacter(ch) ? latinWidth * 2 : latinWidth;
    if (index < text.length - 1) {
      width += letterSpacing;
    }
    index += 1;
  }
  return width;
}

export function wrapSymbolText(
  text: string,
  maxWidthEm: number,
  textSize: number,
  letterSpacing = 0,
): string {
  if (!Number.isFinite(maxWidthEm) || maxWidthEm <= 0) {
    return text;
  }

  const maxLinePixels = maxWidthEm * textSize;
  if (!Number.isFinite(maxLinePixels) || maxLinePixels <= 0) {
    return text;
  }

  const latinGlyphWidth = Math.max(0.45, 0.56 + letterSpacing * 0.15) * textSize;
  const letterSpacingPx = letterSpacing * textSize;

  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const wrapped: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) {
      wrapped.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    if (
      words.length === 1
      && estimateTextWidthPixels(words[0], latinGlyphWidth, letterSpacingPx) <= maxLinePixels
    ) {
      wrapped.push(words[0]);
      continue;
    }

    let line = '';
    let lineWidth = 0;

    for (const word of words) {
      const wordWidth = estimateTextWidthPixels(word, latinGlyphWidth, letterSpacingPx);

      if (wordWidth > maxLinePixels) {
        if (lineWidth > 0) {
          wrapped.push(line);
          line = '';
          lineWidth = 0;
        }

        let chunk = '';
        let chunkWidth = 0;
        for (const ch of word) {
          const chWidth = isWideCharacter(ch) ? latinGlyphWidth * 2 : latinGlyphWidth;
          chunkWidth += chWidth;
          chunk += ch;
          if (chunkWidth >= maxLinePixels) {
            wrapped.push(chunk);
            chunk = '';
            chunkWidth = 0;
          }
        }

        if (chunk.length > 0) {
          line = chunk;
          lineWidth = chunkWidth;
        }
        continue;
      }

      const spaceWidth = lineWidth > 0 ? letterSpacingPx : 0;
      const candidateWidth = lineWidth + spaceWidth + wordWidth;
      if (candidateWidth > maxLinePixels && lineWidth > 0) {
        wrapped.push(line);
        line = word;
        lineWidth = wordWidth;
      }
      else {
        if (spaceWidth > 0) {
          line += ' ';
          lineWidth += spaceWidth;
        }
        line += word;
        lineWidth += wordWidth;
      }
    }

    if (line.length > 0) {
      wrapped.push(line);
    }
  }

  return wrapped.join('\n');
}

export function textOffsetToPixelOffset(
  offset: [number, number] | undefined,
  textSize: number,
): Cartesian2 {
  if (!offset) {
    return new Cartesian2(0, 0);
  }

  return new Cartesian2(offset[0] * textSize, offset[1] * textSize);
}

export function combinePixelOffsets(
  base: Cartesian2,
  translate: Cartesian2 | undefined,
): Cartesian2 {
  if (!translate) {
    return Cartesian2.clone(base, new Cartesian2());
  }

  return Cartesian2.add(base, translate, new Cartesian2());
}

export function resolveTextPixelOffset(
  baseOffset: Cartesian2,
  translate: Cartesian2 | undefined,
  radialOffset: number,
  textSize: number,
  origins: {
    horizontalOrigin: HorizontalOrigin;
    verticalOrigin: VerticalOrigin;
  },
): Cartesian2 {
  const offset = Cartesian2.clone(baseOffset, new Cartesian2());

  if (translate) {
    offset.x += translate.x;
    offset.y += translate.y;
  }

  if (radialOffset !== 0) {
    const radius = radialOffset * textSize;
    offset.x += radius * (HORIZONTAL_ORIGIN_RADIAL_FACTORS[origins.horizontalOrigin] ?? 0);
    offset.y += radius * (VERTICAL_ORIGIN_RADIAL_FACTORS[origins.verticalOrigin] ?? 0);
  }

  return offset;
}

function estimateRectOrigin(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  origins: {
    horizontalOrigin: HorizontalOrigin;
    verticalOrigin: VerticalOrigin;
  },
): SymbolScreenRect {
  let left = offsetX;
  let right = offsetX;
  switch (origins.horizontalOrigin) {
    case HorizontalOrigin.LEFT:
      right = left + width;
      break;
    case HorizontalOrigin.RIGHT:
      left = right - width;
      break;
    default:
      left = offsetX - width / 2;
      right = offsetX + width / 2;
      break;
  }

  let top = offsetY;
  let bottom = offsetY;
  switch (origins.verticalOrigin) {
    case VerticalOrigin.TOP:
      bottom = top + height;
      break;
    case VerticalOrigin.BOTTOM:
      top = bottom - height;
      break;
    default:
      top = offsetY - height / 2;
      bottom = offsetY + height / 2;
      break;
  }

  return {
    left,
    top,
    right,
    bottom,
  };
}

export function estimateScreenRect(
  scene: Scene,
  position: Cartesian3,
  width: number,
  height: number,
  pixelOffset: Cartesian2,
  origins: {
    horizontalOrigin: HorizontalOrigin;
    verticalOrigin: VerticalOrigin;
  },
  padding = 2,
): SymbolScreenRect | undefined {
  const canvasPosition = scene.cartesianToCanvasCoordinates(
    position,
    scratchCanvasPosition,
  );

  if (!canvasPosition) {
    return undefined;
  }

  const offsetX = canvasPosition.x + pixelOffset.x;
  const offsetY = canvasPosition.y - pixelOffset.y;
  const paddedWidth = Math.max(1, width) + Math.max(0, padding) * 2;
  const paddedHeight = Math.max(1, height) + Math.max(0, padding) * 2;

  return estimateRectOrigin(offsetX, offsetY, paddedWidth, paddedHeight, origins);
}

export function normalizeSymbolKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function formatSymbolPositionKey(
  position: Cartesian3,
  precisionMeters = 8,
): string {
  const precision = Math.max(1, precisionMeters);
  return [
    Math.round(position.x / precision),
    Math.round(position.y / precision),
    Math.round(position.z / precision),
  ].join(':');
}

export function buildSymbolDedupeKey(
  layerId: string,
  candidate: SymbolPlacementCandidate,
  text: string | undefined,
): string {
  const textKey = candidate.textKey ? normalizeSymbolKey(candidate.textKey) : text ? normalizeSymbolKey(text) : '';
  const iconKey = candidate.iconImageName ? candidate.iconImageName.trim() : '';
  const sourceKey = textKey.length > 0 ? textKey : iconKey;
  const featureKey
    = candidate.featureId !== undefined
      ? String(candidate.featureId)
      : formatSymbolPositionKey(candidate.position);
  return `${layerId}:${sourceKey}:${featureKey}`;
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
  };
}

export function resolveIconImageDimensions(
  spriteEntry: SpriteAtlasEntry,
  iconSize: number,
  textRect: SymbolScreenRect | undefined,
  iconTextFit: 'none' | 'width' | 'height' | 'both',
  iconTextFitPadding: [number, number, number, number],
): {
  width: number;
  height: number;
} {
  const intrinsicWidth = Math.max(
    1,
    (spriteEntry.width / Math.max(1, spriteEntry.pixelRatio)) * Math.max(0.1, iconSize),
  );
  const intrinsicHeight = Math.max(
    1,
    (spriteEntry.height / Math.max(1, spriteEntry.pixelRatio)) * Math.max(0.1, iconSize),
  );

  if (!textRect || iconTextFit === 'none') {
    return {
      width: intrinsicWidth,
      height: intrinsicHeight,
    };
  }

  const textWidth = Math.max(1, Math.abs(textRect.right - textRect.left));
  const textHeight = Math.max(1, Math.abs(textRect.bottom - textRect.top));
  const targetWidth = textWidth + Math.max(0, iconTextFitPadding[3]) + Math.max(0, iconTextFitPadding[1]);
  const targetHeight = textHeight + Math.max(0, iconTextFitPadding[0]) + Math.max(0, iconTextFitPadding[2]);

  const resolveDimensions = ICON_TEXT_FIT_DIMENSION_RESOLVERS[iconTextFit];
  return resolveDimensions
    ? resolveDimensions({
        intrinsicWidth,
        intrinsicHeight,
        targetWidth,
        targetHeight,
      })
    : {
        width: intrinsicWidth,
        height: intrinsicHeight,
      };
}

export function fontStackToCss(
  fontStack: unknown,
  fallback = DEFAULT_TEXT_FONT_STACK.join(', '),
): string {
  const names = normalizeFontStack(fontStack);
  if (names.length > 0) {
    return names.map(formatFontFamilyName).join(', ');
  }

  const fallbackNames = normalizeFontStack(fallback);
  if (fallbackNames.length > 0) {
    return fallbackNames.map(formatFontFamilyName).join(', ');
  }

  return DEFAULT_TEXT_FONT_STACK.map(formatFontFamilyName).join(', ');
}

function normalizeFontStack(fontStack: unknown): string[] {
  const names = Array.isArray(fontStack)
    ? fontStack.map(font => String(font))
    : typeof fontStack === 'string'
      ? fontStack.split(',')
      : [];

  return names
    .map(font => font.trim().replace(/^['"]+|['"]+$/g, ''))
    .filter(font => font.length > 0);
}

function formatFontFamilyName(font: string): string {
  return /[,"\s]/.test(font)
    ? `"${font.replace(/"/g, '\\"')}"`
    : font;
}
