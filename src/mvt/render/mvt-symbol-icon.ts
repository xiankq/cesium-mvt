import type { MvtBucketFeature, MvtCompiledStyleLayer, MvtStyleSpriteEntry } from '../mvt-types';
import type { MvtWarningContext } from '../mvt-warning-context';
import type { MvtStyleSet } from '../style/mvt-style-set';
import type { MvtResolvedSymbolIcon, MvtSymbolAnchor, MvtSymbolCollisionBox } from './mvt-symbol-types';
import {
  BoundingRectangle,
  Cartesian2,
  Math as CesiumMath,
  Color,
  HorizontalOrigin,
  VerticalOrigin,
} from '@cesium/engine';
import { warnMvtOnce } from '../mvt-warning-context';
import { ICON_BYTE_SIZE } from './mvt-constants';
import { resolveSymbolTranslate, withOpacity } from './mvt-symbol-utils';

export function resolveSymbolIcon(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
  warningContext: MvtWarningContext | undefined,
): MvtResolvedSymbolIcon | undefined {
  const atlas = styleSet.spriteAtlas;
  if (!atlas) {
    warnMvtOnce(
      warningContext,
      `symbol:${layer.id}:missing-sprite-atlas`,
      `symbol layer 依赖 sprite atlas，但当前尚未可用: ${layer.id}`,
      { layerId: layer.id },
    );
    return undefined;
  }

  const iconName = resolveSymbolIconName(styleSet, layer, zoom, feature);
  if (!iconName) {
    return undefined;
  }

  const spriteEntry = atlas.entries.get(iconName);
  if (!spriteEntry) {
    warnMvtOnce(
      warningContext,
      `symbol:${layer.id}:sprite:${iconName}`,
      `sprite atlas 中不存在当前 icon-image，已跳过该图标。`,
      { iconName, layerId: layer.id },
    );
    return undefined;
  }

  const iconSize = Math.max(0, styleSet.evaluateLayoutNumber(layer, 'icon-size', zoom, feature, 1));
  const iconOpacity = styleSet.evaluatePaintNumber(layer, 'icon-opacity', zoom, feature, 1);
  if (iconSize <= 0 || iconOpacity <= 0) {
    return undefined;
  }

  const iconPixelSize = resolveIconPixelSize(spriteEntry, iconSize);
  if (iconPixelSize.width <= 0 || iconPixelSize.height <= 0) {
    return undefined;
  }

  const { horizontalOrigin, verticalOrigin } = resolveOrigins(
    styleSet.evaluateLayoutValue(layer, 'icon-anchor', zoom, feature) as string | undefined,
  );

  return {
    color: resolveIconColor(styleSet, layer, spriteEntry, zoom, feature, iconOpacity),
    height: iconPixelSize.height,
    horizontalOrigin,
    image: atlas.imageUrl,
    imageSubRegion: createSpriteSubRegion(atlas.imageHeight, spriteEntry),
    pixelOffset: resolveIconPixelOffset(styleSet, layer, zoom, feature, iconPixelSize.width, iconPixelSize.height),
    rotation: CesiumMath.toRadians(styleSet.evaluateLayoutNumber(layer, 'icon-rotate', zoom, feature, 0)),
    verticalOrigin,
    width: iconPixelSize.width,
  };
}

export function createSymbolIconCollisionBox(
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

export function estimateIconByteLength(iconCount: number): number {
  return iconCount * ICON_BYTE_SIZE;
}

function resolveSymbolIconName(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
): string | undefined {
  const iconImage = styleSet.evaluateLayoutValue(layer, 'icon-image', zoom, feature);
  if (!iconImage) {
    return undefined;
  }

  const iconName = String(iconImage).trim();
  return iconName || undefined;
}

function resolveIconColor(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  spriteEntry: MvtStyleSpriteEntry,
  zoom: number,
  feature: MvtBucketFeature,
  iconOpacity: number,
): Color {
  if (spriteEntry.sdf) {
    return withOpacity(
      styleSet.evaluatePaintColor(layer, 'icon-color', zoom, feature, Color.WHITE),
      iconOpacity,
    );
  }

  return new Color(1, 1, 1, Math.max(0, Math.min(1, iconOpacity)));
}

function resolveIconPixelOffset(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
  width: number,
  height: number,
): Cartesian2 {
  const offsetValue = styleSet.evaluateLayoutValue(layer, 'icon-offset', zoom, feature);
  if (!Array.isArray(offsetValue) || offsetValue.length < 2) {
    return resolveSymbolTranslate(styleSet, layer, 'icon-translate', zoom, feature);
  }

  const [offsetX, offsetY] = offsetValue;
  if (typeof offsetX !== 'number' || typeof offsetY !== 'number') {
    return resolveSymbolTranslate(styleSet, layer, 'icon-translate', zoom, feature);
  }

  return Cartesian2.add(
    new Cartesian2(offsetX * width * 0.5, -offsetY * height * 0.5),
    resolveSymbolTranslate(styleSet, layer, 'icon-translate', zoom, feature),
    new Cartesian2(),
  );
}

function resolveIconPixelSize(
  spriteEntry: MvtStyleSpriteEntry,
  iconSize: number,
): { height: number; width: number } {
  const pixelRatio = spriteEntry.pixelRatio ?? 1;
  return {
    height: (spriteEntry.height / pixelRatio) * iconSize,
    width: (spriteEntry.width / pixelRatio) * iconSize,
  };
}

function createSpriteSubRegion(imageHeight: number, spriteEntry: MvtStyleSpriteEntry): BoundingRectangle {
  return new BoundingRectangle(
    spriteEntry.x,
    imageHeight - spriteEntry.y - spriteEntry.height,
    spriteEntry.width,
    spriteEntry.height,
  );
}

function resolveOrigins(anchor?: string): {
  horizontalOrigin: HorizontalOrigin;
  verticalOrigin: VerticalOrigin;
} {
  switch (anchor) {
    case 'left':
      return { horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER };
    case 'right':
      return { horizontalOrigin: HorizontalOrigin.RIGHT, verticalOrigin: VerticalOrigin.CENTER };
    case 'top':
      return { horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.TOP };
    case 'bottom':
      return { horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.BOTTOM };
    case 'top-left':
      return { horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.TOP };
    case 'top-right':
      return { horizontalOrigin: HorizontalOrigin.RIGHT, verticalOrigin: VerticalOrigin.TOP };
    case 'bottom-left':
      return { horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.BOTTOM };
    case 'bottom-right':
      return { horizontalOrigin: HorizontalOrigin.RIGHT, verticalOrigin: VerticalOrigin.BOTTOM };
    case 'center':
    default:
      return { horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER };
  }
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
