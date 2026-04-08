import type { MvtBucketFeature, MvtCompiledStyleLayer } from '../mvt-types';
import type { MvtWarningContext } from '../mvt-warning-context';
import type { MvtStyleSet } from '../style/mvt-style-set';
import type {
  MvtResolvedSymbolLabel,
  MvtSymbolAnchor,
  MvtSymbolCollisionBox,
  MvtSymbolLabelItem,
} from './mvt-symbol-types';
import { Cartesian2, Color, HorizontalOrigin, LabelStyle, VerticalOrigin } from '@cesium/engine';
import { warnUnsupportedLayerProperty } from '../mvt-warning-context';
import { getLayerHeightOffset, liftLocalPosition } from './mvt-layer-height';
import { extractPlainTextValue, resolveTextBlock } from './mvt-symbol-text';
import { resolveOrigins, resolveSymbolTranslate, withOpacity } from './mvt-symbol-utils';

export function resolveSymbolLabel(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
  warningContext: MvtWarningContext | undefined,
): MvtResolvedSymbolLabel | undefined {
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

  if (letterSpacing !== 0) {
    warnUnsupportedLayerProperty(warningContext, layer, 'layout', 'text-letter-spacing', {
      reason: 'Cesium label currently does not support per-glyph letter spacing',
    });
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

export function createSymbolLabelCollisionBox(
  anchor: MvtSymbolAnchor,
  height: number,
  horizontalOrigin: HorizontalOrigin,
  pixelOffset: Cartesian2,
  padding: number,
  verticalOrigin: VerticalOrigin,
  width: number,
): MvtSymbolCollisionBox {
  const offsetX = pixelOffset.x * anchor.mapScale;
  const offsetY = pixelOffset.y * anchor.mapScale;
  const widthInMapUnits = width * anchor.mapScale;
  const heightInMapUnits = height * anchor.mapScale;
  const paddingInMapUnits = Math.max(0, padding) * anchor.mapScale;
  const centerX = resolveSymbolHorizontalCenter(anchor.mapX + offsetX, horizontalOrigin, widthInMapUnits);
  const centerY = resolveSymbolVerticalCenter(anchor.mapY + offsetY, verticalOrigin, heightInMapUnits);

  return {
    maxX: centerX + widthInMapUnits * 0.5 + paddingInMapUnits,
    maxY: centerY + heightInMapUnits * 0.5 + paddingInMapUnits,
    minX: centerX - widthInMapUnits * 0.5 - paddingInMapUnits,
    minY: centerY - heightInMapUnits * 0.5 - paddingInMapUnits,
  };
}

export function createMultilineLabelItems(
  anchor: MvtSymbolAnchor,
  label: MvtResolvedSymbolLabel,
  layer: MvtCompiledStyleLayer,
): MvtSymbolLabelItem[] {
  const labelItems: MvtSymbolLabelItem[] = [];
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
  placementGroups: readonly { label?: { items: MvtSymbolLabelItem[] } }[],
): number {
  let total = 0;
  for (const item of placementGroups.flatMap(group => group.label?.items ?? [])) {
    total += 256 + item.text.length * 4 + item.font.length * 2;
  }
  return total + labelLineCount * 24;
}

function resolveSymbolText(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
  warningContext: MvtWarningContext | undefined,
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
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
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
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
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

function resolveSymbolHorizontalCenter(
  anchorX: number,
  horizontalOrigin: HorizontalOrigin,
  width: number,
): number {
  switch (horizontalOrigin) {
    case HorizontalOrigin.LEFT:
      return anchorX + width * 0.5;
    case HorizontalOrigin.RIGHT:
      return anchorX - width * 0.5;
    case HorizontalOrigin.CENTER:
    default:
      return anchorX;
  }
}

function resolveSymbolVerticalCenter(
  anchorY: number,
  verticalOrigin: VerticalOrigin,
  height: number,
): number {
  switch (verticalOrigin) {
    case VerticalOrigin.TOP:
      return anchorY + height * 0.5;
    case VerticalOrigin.BOTTOM:
      return anchorY - height * 0.5;
    case VerticalOrigin.CENTER:
    default:
      return anchorY;
  }
}
