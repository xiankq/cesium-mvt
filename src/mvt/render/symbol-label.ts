import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer } from '../types';
import type { WarningContext } from '../warning-context';
import type { ResolvedSymbolLabel, SymbolAnchor, SymbolLabelItem } from './symbol-types';
import { Cartesian2, Color, LabelStyle } from '@cesium/engine';
import { getLayerHeightOffset, liftLocalPosition } from './layer-height';
import { extractPlainTextValue, resolveTextBlock } from './symbol-text';
import { resolveOrigins, resolveSymbolTranslate, withOpacity } from './symbol-utils';

export function resolveSymbolLabel(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  warningContext: WarningContext | undefined,
): ResolvedSymbolLabel | undefined {
  const text = resolveSymbolText(styleSet, layer, zoom, feature, warningContext);
  if (!text) {
    return undefined;
  }

  const fontSize = styleSet.evaluateLayoutNumber(layer, 'text-size', zoom, feature, 16);
  const textOpacity = styleSet.evaluatePaintNumber(layer, 'text-opacity', zoom, feature, 1);
  const fillColor = withOpacity(
    styleSet.evaluatePaintColor(layer, 'text-color', zoom, feature, Color.BLACK),
    textOpacity,
  );
  const outlineWidth = Math.max(0, styleSet.evaluatePaintNumber(layer, 'text-halo-width', zoom, feature, 0));
  const outlineColor = withOpacity(
    styleSet.evaluatePaintColor(layer, 'text-halo-color', zoom, feature, Color.WHITE),
    textOpacity,
  );
  const letterSpacing = styleSet.evaluateLayoutNumber(layer, 'text-letter-spacing', zoom, feature, 0);
  const lineHeight = styleSet.evaluateLayoutNumber(layer, 'text-line-height', zoom, feature, 1.2);
  const textBlock = resolveTextBlock(text, fontSize, outlineWidth, letterSpacing, lineHeight);
  if (!textBlock) {
    return undefined;
  }

  if (fillColor.alpha <= 0 && (outlineColor.alpha <= 0 || outlineWidth <= 0)) {
    return undefined;
  }

  const { horizontalOrigin, verticalOrigin } = resolveOrigins(
    styleSet.evaluateLayoutValue(layer, 'text-anchor', zoom, feature) as string | undefined,
  );

  return {
    blockHeight: textBlock.height,
    blockWidth: textBlock.width,
    fillColor,
    font: resolveFont(styleSet, layer, zoom, feature, fontSize),
    horizontalOrigin,
    lineHeight: textBlock.lineHeight,
    lines: textBlock.lines,
    outlineColor,
    outlineWidth,
    pixelOffset: resolveTextPixelOffset(styleSet, layer, zoom, feature, fontSize),
    style: outlineWidth > 0 ? LabelStyle.FILL_AND_OUTLINE : LabelStyle.FILL,
    verticalOrigin,
  };
}

export function createMultilineLabelItems(
  anchor: SymbolAnchor,
  label: ResolvedSymbolLabel,
  layer: CompiledStyleLayer,
): SymbolLabelItem[] {
  const labelItems: SymbolLabelItem[] = [];
  const centerIndex = (label.lines.length - 1) * 0.5;

  label.lines.forEach((line, lineIndex) => {
    labelItems.push({
      fillColor: label.fillColor,
      font: label.font,
      horizontalOrigin: label.horizontalOrigin,
      outlineColor: label.outlineColor,
      outlineWidth: label.outlineWidth,
      pixelOffset: Cartesian2.add(
        label.pixelOffset,
        new Cartesian2(0, (centerIndex - lineIndex) * label.lineHeight),
        new Cartesian2(),
      ),
      position: liftLocalPosition(
        anchor.position,
        getLayerHeightOffset(layer, 'symbol-text'),
      ),
      style: label.style,
      text: line,
      verticalOrigin: label.verticalOrigin,
    });
  });

  return labelItems;
}

export function estimateLabelByteLength(
  labelLineCount: number,
  placementGroups: readonly { label?: { items: SymbolLabelItem[] } }[],
): number {
  let total = 0;
  for (const item of placementGroups.flatMap(group => group.label?.items ?? [])) {
    total += 256 + item.text.length * 4 + item.font.length * 2;
  }
  return total + labelLineCount * 24;
}

function resolveSymbolText(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  warningContext: WarningContext | undefined,
): string | undefined {
  const text = extractPlainTextValue(
    styleSet.evaluateLayoutValue(layer, 'text-field', zoom, feature),
    layer,
    'text-field',
    warningContext,
  );
  if (!text?.trim()) {
    return undefined;
  }

  const textTransform = styleSet.evaluateLayoutValue(layer, 'text-transform', zoom, feature);
  if (textTransform === 'uppercase') {
    return text.toUpperCase();
  }
  if (textTransform === 'lowercase') {
    return text.toLowerCase();
  }

  return text;
}

function resolveFont(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  fontSize: number,
): string {
  const fontStack = styleSet.evaluateLayoutValue(layer, 'text-font', zoom, feature);
  if (Array.isArray(fontStack) && fontStack.length) {
    const cssFontStack = fontStack.map(fontName => JSON.stringify(String(fontName))).join(', ');
    return `${Math.max(1, fontSize)}px ${cssFontStack}, sans-serif`;
  }

  return `${Math.max(1, fontSize)}px sans-serif`;
}

function resolveTextPixelOffset(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  fontSize: number,
): Cartesian2 {
  const offsetValue = styleSet.evaluateLayoutValue(layer, 'text-offset', zoom, feature);
  if (!Array.isArray(offsetValue) || offsetValue.length < 2) {
    return resolveSymbolTranslate(styleSet, layer, 'text-translate', zoom, feature);
  }

  const [offsetX, offsetY] = offsetValue;
  if (typeof offsetX !== 'number' || typeof offsetY !== 'number') {
    return resolveSymbolTranslate(styleSet, layer, 'text-translate', zoom, feature);
  }

  return Cartesian2.add(
    new Cartesian2(offsetX * fontSize, -offsetY * fontSize),
    resolveSymbolTranslate(styleSet, layer, 'text-translate', zoom, feature),
    new Cartesian2(),
  );
}
