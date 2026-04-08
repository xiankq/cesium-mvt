import type { MvtCompiledStyleLayer } from '../mvt-types';
import type { MvtWarningContext } from '../mvt-warning-context';
import { warnMvtOnce, warnUnsupportedLayerProperty } from '../mvt-warning-context';

const lineBreakPattern = /\r?\n/u;

export interface MvtResolvedTextBlock {
  height: number;
  lineHeight: number;
  lines: string[];
  plainText: string;
  width: number;
}

interface MvtFormattedLike {
  sections?: Array<{
    fontStack?: unknown;
    image?: unknown;
    scale?: unknown;
    text?: unknown;
    textColor?: unknown;
    verticalAlign?: unknown;
  }>;
}

export function extractPlainTextValue(
  value: unknown,
  layer: MvtCompiledStyleLayer,
  propertyName: string,
  warningContext?: MvtWarningContext,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (isFormattedValue(value)) {
    const plainText = value.sections!
      .map((section) => {
        if (section.image) {
          warnUnsupportedLayerProperty(warningContext, layer, 'layout', propertyName, {
            reason: 'formatted text image sections are not supported',
          });
        }
        if (section.fontStack || section.scale || section.textColor || section.verticalAlign) {
          warnUnsupportedLayerProperty(warningContext, layer, 'layout', propertyName, {
            reason: 'formatted text section overrides are currently flattened to plain text',
          });
        }

        return typeof section.text === 'string' ? section.text : '';
      })
      .join('');

    return plainText || undefined;
  }

  warnMvtOnce(
    warningContext,
    `text-value:${layer.id}:${propertyName}:${typeof value}`,
    `text-field 求值结果当前无法转成可渲染文本: ${layer.id}.${propertyName}`,
    {
      layerId: layer.id,
      propertyName,
      type: typeof value,
      value,
    },
  );
  return undefined;
}

export function resolveTextBlock(
  text: string,
  fontSize: number,
  outlineWidth: number,
  letterSpacingEm = 0,
  lineHeightEm = 1.2,
): MvtResolvedTextBlock | undefined {
  const lines = splitPlainTextLines(text);
  if (!lines.length) {
    return undefined;
  }

  const normalizedFontSize = Math.max(1, fontSize);
  const lineHeight = normalizedFontSize * Math.max(1, lineHeightEm);
  const letterSpacing = Math.max(0, letterSpacingEm) * normalizedFontSize;
  const width = lines.reduce((currentWidth, line) => {
    return Math.max(currentWidth, estimateLineWidth(line, normalizedFontSize, outlineWidth, letterSpacing));
  }, 0);
  const height = normalizedFontSize + Math.max(0, lines.length - 1) * lineHeight + outlineWidth * 2;

  return {
    height,
    lineHeight,
    lines,
    plainText: lines.join('\n'),
    width,
  };
}

export function splitPlainTextLines(text: string): string[] {
  return text
    .split(lineBreakPattern)
    .map(line => line.trim())
    .filter(Boolean);
}

function estimateLineWidth(
  line: string,
  fontSize: number,
  outlineWidth: number,
  letterSpacing: number,
): number {
  if (!line.length) {
    return fontSize;
  }

  return line.length * fontSize * 0.6 + Math.max(0, line.length - 1) * letterSpacing + outlineWidth * 2;
}

function isFormattedValue(value: unknown): value is MvtFormattedLike {
  return Boolean(
    value
    && typeof value === 'object'
    && Array.isArray((value as MvtFormattedLike).sections),
  );
}
