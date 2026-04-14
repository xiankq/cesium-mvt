import type { Color, HorizontalOrigin, VerticalOrigin } from 'cesium';
import type { SymbolLayerStyle } from '../../style/layer-style-resolver';
import type { resolveStyleImage } from '../../style/sprite-atlas';
import { Color as CesiumColor, HorizontalOrigin as CesiumHorizontalOrigin, Math as CesiumMath, VerticalOrigin as CesiumVerticalOrigin } from 'cesium';
import { Formatted } from '../../style/expression-adapter';

const DEFAULT_TEXT_SIZE = 16;
const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
const DEFAULT_TEXT_MAX_WIDTH = 10;
const SYMBOL_TEXT_LINE_BREAK_REGEX = /\r\n|\r|\n/;
const SYMBOL_TEXT_TOKEN_REGEX = /\S+|\s+/g;
const SYMBOL_TEXT_WHITESPACE_TOKEN_REGEX = /^\s+$/u;

export interface SymbolCollision {
  centerOffsetX: number;
  centerOffsetY: number;
  blocksOtherSymbols: boolean;
  halfHeight: number;
  halfWidth: number;
  overlapMode: 'always' | 'cooperative' | 'never';
}

export interface SymbolRenderDecision {
  shouldRenderIcon: boolean;
  shouldRenderText: boolean;
}

export interface ResolvedSymbolTextContent {
  key: string;
  text: string;
  sections?: ResolvedSymbolTextSection[];
}

export interface ResolvedSymbolTextSection {
  text: string;
  image: Formatted['sections'][number]['image'];
  scale: number;
  fontStack?: string[];
  textColor?: string;
  verticalAlign: 'bottom' | 'center' | 'top';
}

export interface SymbolTextSectionLayout {
  kind: 'text' | 'image';
  offsetX: number;
  offsetY: number;
  text: string;
  width: number;
  height: number;
  fontStack?: string[];
  textColor?: string;
  scale: number;
  image?: ReturnType<typeof resolveStyleImage>;
  verticalAlign: 'bottom' | 'center' | 'top';
}

export interface SymbolTextLayout {
  height: number;
  sections: SymbolTextSectionLayout[];
  width: number;
}

export function resolveSymbolRenderDecision(
  symbolStyle: SymbolLayerStyle,
  textPlacement: unknown,
  iconPlacement: unknown,
  iconImage: ReturnType<typeof resolveStyleImage> | undefined,
): SymbolRenderDecision | undefined {
  const shouldRenderText = Boolean(symbolStyle.textField && textPlacement);
  const shouldRenderIcon = Boolean(iconImage && iconPlacement);

  if (symbolStyle.textField && iconImage) {
    if (!shouldRenderText && !shouldRenderIcon) {
      return undefined;
    }

    if (!shouldRenderText && !symbolStyle.textOptional) {
      return undefined;
    }

    if (!shouldRenderIcon && !symbolStyle.iconOptional) {
      return undefined;
    }

    return {
      shouldRenderIcon,
      shouldRenderText,
    };
  }

  if (symbolStyle.textField) {
    return shouldRenderText
      ? {
          shouldRenderIcon: false,
          shouldRenderText,
        }
      : undefined;
  }

  if (iconImage) {
    return shouldRenderIcon
      ? {
          shouldRenderIcon,
          shouldRenderText: false,
        }
      : undefined;
  }

  return undefined;
}

export function combineSymbolCollisions(
  anchorX: number,
  anchorY: number,
  ...placements: Array<{
    collision?: SymbolCollision;
  } | undefined>
): SymbolCollision | undefined {
  const boxes = placements
    .map(placement => placement?.collision)
    .filter((collision): collision is SymbolCollision => collision !== undefined);

  if (boxes.length === 0) {
    return undefined;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let blocksOtherSymbols = false;
  const overlapModes = new Set<SymbolCollision['overlapMode']>();

  for (const collision of boxes) {
    const centerX = anchorX + collision.centerOffsetX;
    const centerY = anchorY + collision.centerOffsetY;
    minX = Math.min(minX, centerX - collision.halfWidth);
    minY = Math.min(minY, centerY - collision.halfHeight);
    maxX = Math.max(maxX, centerX + collision.halfWidth);
    maxY = Math.max(maxY, centerY + collision.halfHeight);
    blocksOtherSymbols = blocksOtherSymbols || collision.blocksOtherSymbols;
    overlapModes.add(collision.overlapMode);
  }

  return {
    blocksOtherSymbols,
    centerOffsetX: (minX + maxX) / 2 - anchorX,
    centerOffsetY: (minY + maxY) / 2 - anchorY,
    halfHeight: (maxY - minY) / 2,
    halfWidth: (maxX - minX) / 2,
    overlapMode: overlapModes.has('never')
      ? 'never'
      : overlapModes.has('cooperative')
        ? 'cooperative'
        : 'always',
  };
}

// Cesium 的 Label.text 只能接收纯字符串，图片片段在无图时只能降级成稳定占位符。
const FORMATTED_IMAGE_PLACEHOLDER = '□';

export function resolveSymbolTextContent(
  text: string | Formatted | undefined,
  transform: SymbolLayerStyle['textTransform'],
): ResolvedSymbolTextContent {
  if (text instanceof Formatted) {
    return resolveFormattedSymbolTextContent(text, transform);
  }

  const rawText = typeof text === 'string' ? text : '';
  return {
    key: applyTextTransform(rawText, transform),
    text: applyTextTransform(rawText, transform),
  };
}

export function resolveSymbolRenderedText(
  symbolStyle: SymbolLayerStyle,
  symbolText: string,
): string {
  if (!symbolText) {
    return '';
  }

  return wrapSymbolText(
    symbolText,
    symbolStyle.textSize ?? DEFAULT_TEXT_SIZE,
    symbolStyle.textLetterSpacing ?? 0,
    symbolStyle.textMaxWidth ?? DEFAULT_TEXT_MAX_WIDTH,
  );
}

export function resolveLabelFont(
  symbolStyle: SymbolLayerStyle,
  formattedFontStack?: string[],
  fontSize = symbolStyle.textSize ?? DEFAULT_TEXT_SIZE,
): string {
  let fontFamily = 'sans-serif';
  if (formattedFontStack?.length) {
    fontFamily = formattedFontStack.join(',');
  }
  else if (symbolStyle.textFont?.length) {
    fontFamily = symbolStyle.textFont.join(',');
  }

  if (symbolStyle.textLineHeight !== undefined) {
    return `${fontSize}px/${symbolStyle.textLineHeight} ${fontFamily}`;
  }

  return `${fontSize}px ${fontFamily}`;
}

export function resolveIconTextFitDimensions(
  symbolStyle: SymbolLayerStyle,
  symbolText: ResolvedSymbolTextContent,
  iconImage: ReturnType<typeof resolveStyleImage>,
  formattedLayout?: SymbolTextLayout,
): {
  height: number;
  width: number;
} | undefined {
  if (!symbolStyle.textField || !iconImage || symbolStyle.iconTextFit === undefined || symbolStyle.iconTextFit === 'none') {
    return undefined;
  }

  const measured = measureSymbolContentBox(symbolStyle, symbolText, iconImage, formattedLayout);
  const padding = symbolStyle.iconTextFitPadding ?? [0, 0, 0, 0];
  const targetWidth = measured.textWidth + padding[1] + padding[3];
  const targetHeight = measured.textHeight + padding[0] + padding[2];
  const iconSize = symbolStyle.iconSize ?? 1;
  const baseWidth = (iconImage.width * iconSize);
  const baseHeight = (iconImage.height * iconSize);

  if (baseWidth === 0 || baseHeight === 0) {
    return undefined;
  }

  switch (symbolStyle.iconTextFit) {
    case 'width': {
      const scale = targetWidth / baseWidth;
      return {
        height: baseHeight * scale,
        width: targetWidth,
      };
    }
    case 'height': {
      const scale = targetHeight / baseHeight;
      return {
        height: targetHeight,
        width: baseWidth * scale,
      };
    }
    case 'both':
      return {
        height: targetHeight,
        width: targetWidth,
      };
    default:
      return undefined;
  }
}

export function convertHorizontalOrigin(
  anchor?: SymbolLayerStyle['textAnchor'],
): HorizontalOrigin {
  if (!anchor) {
    return CesiumHorizontalOrigin.CENTER;
  }
  if (anchor.includes('left')) {
    return CesiumHorizontalOrigin.LEFT;
  }
  if (anchor.includes('right')) {
    return CesiumHorizontalOrigin.RIGHT;
  }
  return CesiumHorizontalOrigin.CENTER;
}

export function convertVerticalOrigin(
  anchor?: SymbolLayerStyle['textAnchor'],
): VerticalOrigin {
  if (!anchor) {
    return CesiumVerticalOrigin.BOTTOM;
  }
  if (anchor.includes('top')) {
    return CesiumVerticalOrigin.TOP;
  }
  if (anchor.includes('bottom')) {
    return CesiumVerticalOrigin.BOTTOM;
  }
  return CesiumVerticalOrigin.BOTTOM;
}

export function resolveColor(
  value: string | undefined,
  opacity: number | undefined,
  fallback: Color,
): Color {
  const color = value
    ? CesiumColor.fromCssColorString(value) ?? CesiumColor.clone(fallback)
    : CesiumColor.clone(fallback);

  color.alpha *= clampOpacity(opacity ?? 1);
  return color;
}

export function resolveTextHaloColor(symbolStyle: SymbolLayerStyle): Color {
  const value = symbolStyle.textHaloColor ?? 'rgba(0, 0, 0, 0)';
  const color = CesiumColor.fromCssColorString(value) ?? CesiumColor.clone(CesiumColor.TRANSPARENT);
  return color;
}

export function resolveTextHaloWidth(symbolStyle: SymbolLayerStyle): number {
  // Cesium 只支持硬轮廓，没有 MapLibre 的 halo blur；这里用 blur 叠加到宽度上做近似。
  return Math.max(
    0,
    (symbolStyle.textHaloWidth ?? 0) + (symbolStyle.textHaloBlur ?? 0),
  );
}

export function combinePixelOffsets(
  base?: [number, number],
  translate?: [number, number],
): [number, number] | undefined {
  if (!base && !translate) {
    return undefined;
  }

  return [
    (base?.[0] ?? 0) + (translate?.[0] ?? 0),
    (base?.[1] ?? 0) + (translate?.[1] ?? 0),
  ];
}

export function toCesiumRotation(rotation: number | undefined): number | undefined {
  if (rotation === undefined) {
    return undefined;
  }

  // MapLibre 的 rotate 是顺时针，Cesium 的 rotation 是逆时针，方向相反。
  return -CesiumMath.toRadians(rotation);
}

export function measureSymbolContentBox(
  symbolStyle: SymbolLayerStyle,
  symbolText: ResolvedSymbolTextContent,
  iconImage: ReturnType<typeof resolveStyleImage> | undefined,
  formattedLayout?: SymbolTextLayout,
): {
  height: number;
  iconHeight: number;
  iconWidth: number;
  textHeight: number;
  textWidth: number;
  width: number;
} {
  const textSize = symbolStyle.textSize ?? DEFAULT_TEXT_SIZE;
  const textPadding = symbolStyle.textPadding ?? 0;
  const textLineHeight = symbolStyle.textLineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
  const textLetterSpacing = symbolStyle.textLetterSpacing ?? 0;
  const measuredTextWidth = formattedLayout
    ? formattedLayout.width
    : measureSymbolTextWidth(
        symbolText.text,
        textSize,
        textLetterSpacing,
      );
  const measuredTextHeight = formattedLayout
    ? formattedLayout.height
    : measureSymbolTextHeight(
        symbolText.text,
        textSize,
        textLineHeight,
      );
  const textWidth = measuredTextWidth > 0
    ? measuredTextWidth + textPadding * 2
    : 0;
  const textHeight = measuredTextHeight > 0
    ? measuredTextHeight + textPadding * 2
    : 0;

  const iconSize = symbolStyle.iconSize ?? 1;
  const iconPadding = symbolStyle.iconPadding ?? 0;
  const iconWidth = iconImage
    ? (iconImage.width * iconSize) + iconPadding * 2
    : 0;
  const iconHeight = iconImage
    ? (iconImage.height * iconSize) + iconPadding * 2
    : 0;

  return {
    height: Math.max(textHeight, iconHeight),
    iconHeight,
    iconWidth,
    textHeight,
    textWidth,
    width: Math.max(textWidth, iconWidth),
  };
}

export function layoutFormattedSymbolContent(
  symbolStyle: SymbolLayerStyle,
  sections: ResolvedSymbolTextSection[],
  resolveSectionImage: (image: Formatted['sections'][number]['image']) => ReturnType<typeof resolveStyleImage> | undefined,
): SymbolTextLayout {
  const textSize = symbolStyle.textSize ?? DEFAULT_TEXT_SIZE;
  const textLineHeight = symbolStyle.textLineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
  const textLetterSpacing = symbolStyle.textLetterSpacing ?? 0;
  const textMaxWidth = symbolStyle.textMaxWidth ?? DEFAULT_TEXT_MAX_WIDTH;
  const layouts: SymbolTextSectionLayout[] = [];
  let cursorX = 0;
  let maxHeight = 0;

  for (const section of sections) {
    const scale = section.scale || 1;
    const sectionTextSize = textSize * scale;

    if (section.image) {
      const image = resolveSectionImage(section.image);
      const width = image
        ? image.width * scale
        : estimateSymbolTextLineWidth(FORMATTED_IMAGE_PLACEHOLDER, sectionTextSize, textLetterSpacing);
      const height = image
        ? image.height * scale
        : sectionTextSize;
      layouts.push({
        kind: image ? 'image' : 'text',
        offsetX: cursorX,
        offsetY: 0,
        text: image ? '' : FORMATTED_IMAGE_PLACEHOLDER,
        width,
        height,
        fontStack: section.fontStack,
        textColor: section.textColor,
        scale,
        image,
        verticalAlign: section.verticalAlign,
      });
      cursorX += width;
      maxHeight = Math.max(maxHeight, height);
      continue;
    }

    const renderedText = section.text.trim().length === 0
      ? section.text
      : wrapSymbolText(
          section.text,
          sectionTextSize,
          textLetterSpacing,
          textMaxWidth,
        );
    const width = measureFormattedSectionWidth(
      renderedText,
      sectionTextSize,
      textLetterSpacing,
    );
    const height = measureFormattedSectionHeight(
      renderedText,
      sectionTextSize,
      textLineHeight,
    );
    layouts.push({
      kind: 'text',
      offsetX: cursorX,
      offsetY: 0,
      text: renderedText,
      width,
      height,
      fontStack: section.fontStack,
      textColor: section.textColor,
      scale,
      verticalAlign: section.verticalAlign,
    });
    cursorX += width;
    maxHeight = Math.max(maxHeight, height);
  }

  for (const layout of layouts) {
    layout.offsetY = resolveFormattedSectionOffset(layout.verticalAlign, maxHeight, layout.height);
  }

  return {
    height: maxHeight,
    sections: layouts,
    width: cursorX,
  };
}

export function resolveSymbolAnchorOffset(
  anchor: SymbolLayerStyle['textAnchor'],
  width: number,
  height: number,
): {
  x: number;
  y: number;
} {
  let offsetX = 0;
  let offsetY = 0;

  if (anchor?.includes('left')) {
    offsetX = width / 2;
  }
  else if (anchor?.includes('right')) {
    offsetX = -width / 2;
  }

  if (anchor?.includes('top')) {
    offsetY = height / 2;
  }
  else if (anchor?.includes('bottom')) {
    offsetY = -height / 2;
  }

  return {
    x: offsetX,
    y: offsetY,
  };
}

function wrapSymbolText(
  symbolText: string,
  textSize: number,
  textLetterSpacing: number,
  textMaxWidth: number,
): string {
  if (!symbolText) {
    return '';
  }

  if (!Number.isFinite(textMaxWidth) || textMaxWidth <= 0 || textSize <= 0) {
    return symbolText;
  }

  const maxLineWidth = textMaxWidth * textSize;
  const paragraphs = symbolText.split(SYMBOL_TEXT_LINE_BREAK_REGEX);
  const wrappedLines: string[] = [];

  for (const paragraph of paragraphs) {
    const paragraphLines = wrapSymbolParagraph(
      paragraph,
      maxLineWidth,
      textSize,
      textLetterSpacing,
    );
    if (paragraphLines.length === 0) {
      wrappedLines.push('');
      continue;
    }

    wrappedLines.push(...paragraphLines);
  }

  if (wrappedLines.length === 0) {
    return '';
  }

  // 这里保留显式换行，同时让自动换行只负责补充断行，不改写原始段落顺序。
  return wrappedLines.join('\n');
}

function wrapSymbolParagraph(
  paragraph: string,
  maxLineWidth: number,
  textSize: number,
  textLetterSpacing: number,
): string[] {
  if (!paragraph) {
    return [''];
  }

  const tokens = paragraph.match(SYMBOL_TEXT_TOKEN_REGEX) ?? [];
  const lines: string[] = [];
  let currentLine = '';

  const pushCurrentLine = (): void => {
    if (currentLine.length === 0) {
      return;
    }
    lines.push(currentLine.trimEnd());
    currentLine = '';
  };

  for (const token of tokens) {
    if (SYMBOL_TEXT_WHITESPACE_TOKEN_REGEX.test(token)) {
      if (currentLine.length === 0) {
        continue;
      }

      const candidateLine = currentLine + token;
      if (estimateSymbolTextLineWidth(candidateLine, textSize, textLetterSpacing) <= maxLineWidth) {
        currentLine = candidateLine;
        continue;
      }

      pushCurrentLine();
      continue;
    }

    if (currentLine.length === 0) {
      if (estimateSymbolTextLineWidth(token, textSize, textLetterSpacing) <= maxLineWidth) {
        currentLine = token;
        continue;
      }

      const brokenTokens = breakSymbolTextToken(
        token,
        maxLineWidth,
        textSize,
        textLetterSpacing,
      );
      lines.push(...brokenTokens.slice(0, -1));
      currentLine = brokenTokens[brokenTokens.length - 1] ?? '';
      continue;
    }

    const candidateLine = currentLine + token;
    if (estimateSymbolTextLineWidth(candidateLine, textSize, textLetterSpacing) <= maxLineWidth) {
      currentLine = candidateLine;
      continue;
    }

    pushCurrentLine();

    if (estimateSymbolTextLineWidth(token, textSize, textLetterSpacing) <= maxLineWidth) {
      currentLine = token;
      continue;
    }

    const brokenTokens = breakSymbolTextToken(
      token,
      maxLineWidth,
      textSize,
      textLetterSpacing,
    );
    lines.push(...brokenTokens.slice(0, -1));
    currentLine = brokenTokens[brokenTokens.length - 1] ?? '';
  }

  pushCurrentLine();

  if (lines.length === 0) {
    return [''];
  }

  return lines;
}

function breakSymbolTextToken(
  token: string,
  maxLineWidth: number,
  textSize: number,
  textLetterSpacing: number,
): string[] {
  const characters = Array.from(token);
  if (characters.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let currentLine = '';

  for (const character of characters) {
    const candidateLine = currentLine + character;
    if (currentLine.length === 0
      || estimateSymbolTextLineWidth(candidateLine, textSize, textLetterSpacing) <= maxLineWidth) {
      currentLine = candidateLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = character;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

function estimateSymbolTextLineWidth(
  line: string,
  textSize: number,
  textLetterSpacing: number,
): number {
  if (!line) {
    return 0;
  }

  const characterCount = Array.from(line).length;
  if (characterCount === 0) {
    return 0;
  }

  const estimatedWidth = (characterCount * textSize * 0.6)
    + Math.max(0, characterCount - 1) * textLetterSpacing * textSize;
  return Math.max(textSize, estimatedWidth);
}

function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveFormattedSymbolTextContent(
  formatted: Formatted,
  transform: SymbolLayerStyle['textTransform'],
): ResolvedSymbolTextContent {
  const sections = formatted.sections ?? [];
  const textParts: string[] = [];
  const resolvedSections = sections.map(section => ({
    image: section.image,
    scale: section.scale ?? 1,
    text: applyTextTransform(section.text ?? '', transform),
    textColor: section.textColor?.toString(),
    fontStack: normalizeFontStack(section.fontStack ?? undefined),
    verticalAlign: section.verticalAlign ?? 'bottom',
  }));

  for (const section of resolvedSections) {
    if (section.image) {
      textParts.push(FORMATTED_IMAGE_PLACEHOLDER);
      continue;
    }

    textParts.push(section.text);
  }

  const hasFormattedSections = resolvedSections.some(section => section.image
    || section.scale !== 1
    || section.textColor !== undefined
    || section.fontStack !== undefined
    || section.verticalAlign !== 'bottom');

  if (!hasFormattedSections) {
    const text = applyTextTransform(formatted.toString(), transform);
    return {
      key: text,
      text,
    };
  }

  return {
    key: resolvedSections.map(section => section.image
      ? `image:${section.image.name}`
      : `text:${section.text}`).join('\u0001'),
    text: textParts.join(''),
    sections: resolvedSections,
  };
}

function applyTextTransform(
  text: string,
  transform: SymbolLayerStyle['textTransform'],
): string {
  if (!text) {
    return '';
  }

  switch (transform) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    default:
      return text;
  }
}

function normalizeFontStack(fontStack: string | string[] | null | undefined): string[] | undefined {
  if (fontStack === undefined || fontStack === null) {
    return undefined;
  }

  const fontFamilies = Array.isArray(fontStack)
    ? fontStack
    : fontStack.split(',');

  const normalizedFontFamilies = fontFamilies
    .map(fontFamily => fontFamily.trim())
    .filter(fontFamily => fontFamily.length > 0);

  return normalizedFontFamilies.length > 0 ? normalizedFontFamilies : undefined;
}

function measureSymbolTextWidth(
  text: string,
  textSize: number,
  textLetterSpacing: number,
): number {
  if (!text) {
    return 0;
  }

  const lines = text.split(SYMBOL_TEXT_LINE_BREAK_REGEX);
  return Math.max(
    ...lines.map(line => estimateSymbolTextLineWidth(line, textSize, textLetterSpacing)),
  );
}

function measureSymbolTextHeight(
  text: string,
  textSize: number,
  textLineHeight: number,
): number {
  if (!text) {
    return 0;
  }

  const lineCount = text.split(SYMBOL_TEXT_LINE_BREAK_REGEX).length;
  return textSize + Math.max(0, lineCount - 1) * textSize * textLineHeight;
}

function measureFormattedSectionWidth(
  text: string,
  textSize: number,
  textLetterSpacing: number,
): number {
  if (!text) {
    return 0;
  }

  return measureSymbolTextWidth(text, textSize, textLetterSpacing);
}

function measureFormattedSectionHeight(
  text: string,
  textSize: number,
  textLineHeight: number,
): number {
  if (!text) {
    return 0;
  }

  return measureSymbolTextHeight(text, textSize, textLineHeight);
}

function resolveFormattedSectionOffset(
  verticalAlign: 'bottom' | 'center' | 'top',
  groupHeight: number,
  sectionHeight: number,
): number {
  switch (verticalAlign) {
    case 'top':
      return 0;
    case 'center':
      return (groupHeight - sectionHeight) / 2;
    default:
      return groupHeight - sectionHeight;
  }
}
