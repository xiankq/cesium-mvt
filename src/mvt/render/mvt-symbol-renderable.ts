import type {
  Billboard,
  Label,
} from '@cesium/engine';
import type Point from '@mapbox/point-geometry';
import type { MvtDisplayFeatureCache } from '../mesh/mvt-display-feature';
import type { MvtBucketFeature, MvtCompiledStyleLayer, MvtStyleSpriteEntry } from '../mvt-types';
import type { MvtWarningContext } from '../mvt-warning-context';
import type { MvtStyleSet } from '../style/mvt-style-set';
import type { MvtSymbolCollisionIndex } from './mvt-symbol-collision';
import type { MvtCompositeSpriteItem } from './mvt-symbol-composite';
import type { createMvtTileTransform } from './mvt-tile-transform';
import {
  BillboardCollection,
  BoundingRectangle,
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
  Color,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  VerticalOrigin,
} from '@cesium/engine';
import { getClippedDisplayFeature } from '../mesh/mvt-display-feature';
import { normalizePolylinePoints } from '../mesh/mvt-geometry-normalize';
import { warnMvtOnce, warnUnsupportedLayerProperty } from '../mvt-warning-context';
import { getLayerHeightOffset, liftLocalPosition } from './mvt-layer-height';
import { getTileUnitsPerPixel } from './mvt-style-geometry';
import {
  buildCompositeSpriteAtlas,
  createCompositeCacheKey,
  getOrCreateCompositeSpriteEntry,
} from './mvt-symbol-composite';
import { extractPlainTextValue, resolveTextBlock } from './mvt-symbol-text';
import { projectTilePointToLocalCartesian } from './mvt-tile-transform';

export interface MvtTileRenderableLike {
  byteLength: number;
  destroy: () => void;
  update: (frameState: unknown, collisionIndex?: MvtSymbolCollisionIndex) => void;
}

interface MvtSymbolAnchor {
  angle: number;
  mapScale: number;
  mapX: number;
  mapY: number;
  position: Cartesian3;
}

interface MvtSymbolIconItem {
  billboard?: Billboard;
  color: Color;
  collisionBox?: { maxX: number; maxY: number; minX: number; minY: number };
  compositeKey?: string;
  compositeLabel?: MvtResolvedSymbolLabel;
  height: number;
  horizontalOrigin: HorizontalOrigin;
  image: string;
  imageSubRegion: BoundingRectangle;
  pixelOffset: Cartesian2;
  position: Cartesian3;
  rotation: number;
  verticalOrigin: VerticalOrigin;
  width: number;
}

interface MvtSymbolLabelItem {
  fillColor: Color;
  font: string;
  horizontalOrigin: HorizontalOrigin;
  label?: Label;
  outlineColor: Color;
  outlineWidth: number;
  pixelOffset: Cartesian2;
  position: Cartesian3;
  style: LabelStyle;
  text: string;
  verticalOrigin: VerticalOrigin;
}

interface MvtSymbolLabelGroup {
  collisionBox?: { maxX: number; maxY: number; minX: number; minY: number };
  items: MvtSymbolLabelItem[];
}

interface MvtSymbolPlacementGroup {
  icon?: MvtSymbolIconItem;
  label?: MvtSymbolLabelGroup;
  visible?: boolean;
}

export interface MvtResolvedSymbolIcon {
  color: Color;
  height: number;
  horizontalOrigin: HorizontalOrigin;
  image: string;
  imageSubRegion: BoundingRectangle;
  pixelOffset: Cartesian2;
  rotation: number;
  verticalOrigin: VerticalOrigin;
  width: number;
}

export interface MvtResolvedSymbolLabel {
  blockHeight: number;
  blockWidth: number;
  fillColor: Color;
  font: string;
  horizontalOrigin: HorizontalOrigin;
  lineHeight: number;
  lines: string[];
  outlineColor: Color;
  outlineWidth: number;
  pixelOffset: Cartesian2;
  style: LabelStyle;
  verticalOrigin: VerticalOrigin;
}

export function createSymbolRenderable(
  styleSet: MvtStyleSet,
  features: readonly MvtBucketFeature[],
  extent: number,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  transform: ReturnType<typeof createMvtTileTransform>,
  collisionIndex?: MvtSymbolCollisionIndex,
  displayFeatureCache?: MvtDisplayFeatureCache,
  warningContext?: MvtWarningContext,
): MvtTileRenderableLike | undefined {
  warnUnsupportedSymbolLayerProperties(layer, warningContext);

  const placementGroups: MvtSymbolPlacementGroup[] = [];
  let iconCandidateCount = 0;
  let labelLineCount = 0;
  const compositeItems: MvtCompositeSpriteItem[] = [];
  const compositeCache = styleSet.compositeSpriteCache;

  for (const feature of features) {
    const displayFeature = getClippedDisplayFeature(feature, extent, transform, displayFeatureCache);
    if (!displayFeature) {
      continue;
    }

    const anchors = resolveSymbolAnchors(styleSet, displayFeature, extent, layer, transform, zoom);
    if (!anchors.length) {
      continue;
    }

    const nextPlacementGroups = createSymbolPlacementGroups(
      anchors,
      feature,
      layer,
      styleSet,
      zoom,
      warningContext,
    );
    if (!nextPlacementGroups.length) {
      continue;
    }

    for (const group of nextPlacementGroups) {
      if (group.icon) {
        iconCandidateCount += 1;
        if (group.icon.compositeKey && group.icon.compositeLabel) {
          const entry = getOrCreateCompositeSpriteEntry(
            group.icon,
            group.icon.compositeLabel,
            compositeCache,
            'both',
            [0, 0, 0, 0],
          );
          if (entry) {
            compositeItems.push({
              entry,
              icon: group.icon,
              key: group.icon.compositeKey,
              label: group.icon.compositeLabel,
            });
          }
        }
      }
      if (group.label) {
        labelLineCount += group.label.items.length;
      }
      placementGroups.push(group);
    }
  }

  if (!placementGroups.length) {
    return undefined;
  }

  const spriteAtlas = styleSet.spriteAtlas;
  let compositeAtlas: ReturnType<typeof buildCompositeSpriteAtlas> | undefined;
  if (compositeItems.length > 0 && spriteAtlas) {
    compositeAtlas = buildCompositeSpriteAtlas(compositeItems, spriteAtlas);
  }

  const billboardCollection = createBillboardCollection(placementGroups, transform, compositeAtlas);
  const labelCollection = createLabelCollection(placementGroups, transform);
  const byteLength = estimateIconByteLength(iconCandidateCount) + estimateLabelByteLength(labelLineCount, placementGroups);

  return {
    byteLength,
    destroy: () => {
      billboardCollection?.destroy();
      labelCollection?.destroy();
    },
    update: (frameState: unknown, nextCollisionIndex = collisionIndex) => {
      applyPlacementVisibility(placementGroups, nextCollisionIndex);

      if (!canUpdateCesiumCollections(frameState)) {
        return;
      }

      (billboardCollection as unknown as { update: (state: unknown) => void } | undefined)?.update(frameState);
      (labelCollection as unknown as { update: (state: unknown) => void } | undefined)?.update(frameState);
    },
  };
}

function createSymbolPlacementGroups(
  anchors: readonly MvtSymbolAnchor[],
  feature: MvtBucketFeature,
  layer: MvtCompiledStyleLayer,
  styleSet: MvtStyleSet,
  zoom: number,
  warningContext: MvtWarningContext | undefined,
): MvtSymbolPlacementGroup[] {
  const resolvedLabel = resolveSymbolLabel(styleSet, layer, zoom, feature, warningContext);
  let resolvedIcon = resolveSymbolIcon(styleSet, layer, zoom, feature, warningContext);
  if (!resolvedLabel && !resolvedIcon) {
    return [];
  }

  let iconTextFit: string | undefined;
  let iconTextFitPadding: [number, number, number, number] = [0, 0, 0, 0];
  let shouldComposite = false;

  if (resolvedIcon && resolvedLabel) {
    iconTextFit = styleSet.evaluateLayoutValue(layer, 'icon-text-fit', zoom, feature) as string | undefined;
    if (iconTextFit && iconTextFit !== 'none') {
      iconTextFitPadding = resolveIconTextFitPadding(styleSet, layer, zoom, feature);
      resolvedIcon = applyIconTextFit(resolvedIcon, resolvedLabel, iconTextFit, iconTextFitPadding);
      shouldComposite = true;
    }
  }

  const iconAllowOverlap = resolveSymbolBoolean(styleSet, layer, 'icon-allow-overlap', zoom, feature, false);
  const iconIgnorePlacement = resolveSymbolBoolean(styleSet, layer, 'icon-ignore-placement', zoom, feature, false);
  const iconPadding = styleSet.evaluateLayoutNumber(layer, 'icon-padding', zoom, feature, 2);
  const textAllowOverlap = resolveSymbolBoolean(styleSet, layer, 'text-allow-overlap', zoom, feature, false);
  const textIgnorePlacement = resolveSymbolBoolean(styleSet, layer, 'text-ignore-placement', zoom, feature, false);
  const textPadding = styleSet.evaluateLayoutNumber(layer, 'text-padding', zoom, feature, 2);
  const iconAlignment = resolveRotationAlignment(
    styleSet.evaluateLayoutValue(layer, 'icon-rotation-alignment', zoom, feature),
  );
  const placementGroups: MvtSymbolPlacementGroup[] = [];

  for (const anchor of anchors) {
    const placementGroup: MvtSymbolPlacementGroup = {};
    if (resolvedIcon) {
      placementGroup.icon = {
        ...resolvedIcon,
        collisionBox: !iconAllowOverlap && !iconIgnorePlacement
          ? createSymbolCollisionBox(
              anchor,
              resolvedIcon.height,
              resolvedIcon.horizontalOrigin,
              resolvedIcon.pixelOffset,
              iconPadding,
              resolvedIcon.verticalOrigin,
              resolvedIcon.width,
            )
          : undefined,
        compositeKey: shouldComposite
          ? createCompositeCacheKey(resolvedIcon, iconTextFit!, iconTextFitPadding)
          : undefined,
        compositeLabel: shouldComposite ? resolvedLabel : undefined,
        position: liftLocalPosition(
          Cartesian3.clone(anchor.position),
          getLayerHeightOffset(layer, 'symbol-icon'),
        ),
        rotation: iconAlignment === 'viewport'
          ? resolvedIcon.rotation
          : anchor.angle - resolvedIcon.rotation,
      };
    }

    if (resolvedLabel && !shouldComposite) {
      placementGroup.label = {
        collisionBox: !textAllowOverlap && !textIgnorePlacement
          ? createSymbolCollisionBox(
              anchor,
              resolvedLabel.blockHeight,
              resolvedLabel.horizontalOrigin,
              resolvedLabel.pixelOffset,
              textPadding,
              resolvedLabel.verticalOrigin,
              resolvedLabel.blockWidth,
            )
          : undefined,
        items: createMultilineLabelItems(anchor, resolvedLabel, layer),
      };
    }

    if (placementGroup.icon || placementGroup.label?.items.length) {
      placementGroups.push(placementGroup);
    }
  }

  return placementGroups;
}

function canUpdateCesiumCollections(frameState: unknown): frameState is { commandList: unknown[]; context: object } {
  if (!frameState || typeof frameState !== 'object') {
    return false;
  }

  const candidate = frameState as Record<string, unknown>;
  return Array.isArray(candidate.commandList) && typeof candidate.context === 'object' && candidate.context !== null;
}

function applyPlacementVisibility(
  placementGroups: readonly MvtSymbolPlacementGroup[],
  collisionIndex?: MvtSymbolCollisionIndex,
): number {
  let visiblePlacementCount = 0;

  for (const placementGroup of placementGroups) {
    const visible = !collisionIndex || !collidesWithPlacementGroup(placementGroup, collisionIndex);
    if (visible) {
      insertPlacementCollisionBoxes(placementGroup, collisionIndex);
      visiblePlacementCount += 1;
    }

    setPlacementGroupVisible(placementGroup, visible);
  }

  return visiblePlacementCount;
}

function collidesWithPlacementGroup(
  placementGroup: MvtSymbolPlacementGroup,
  collisionIndex: MvtSymbolCollisionIndex,
): boolean {
  return Boolean(
    (placementGroup.icon?.collisionBox && collisionIndex.collides(placementGroup.icon.collisionBox))
    || (placementGroup.label?.collisionBox && collisionIndex.collides(placementGroup.label.collisionBox)),
  );
}

function insertPlacementCollisionBoxes(
  placementGroup: MvtSymbolPlacementGroup,
  collisionIndex?: MvtSymbolCollisionIndex,
): void {
  if (!collisionIndex) {
    return;
  }

  if (placementGroup.icon?.collisionBox) {
    collisionIndex.insert(placementGroup.icon.collisionBox);
  }
  if (placementGroup.label?.collisionBox) {
    collisionIndex.insert(placementGroup.label.collisionBox);
  }
}

function setPlacementGroupVisible(
  placementGroup: MvtSymbolPlacementGroup,
  visible: boolean,
): void {
  if (placementGroup.visible === visible) {
    return;
  }

  placementGroup.visible = visible;
  if (placementGroup.icon?.billboard) {
    placementGroup.icon.billboard.show = visible;
  }
  for (const item of placementGroup.label?.items ?? []) {
    if (item.label) {
      item.label.show = visible;
    }
  }
}

function createBillboardCollection(
  placementGroups: readonly MvtSymbolPlacementGroup[],
  transform: ReturnType<typeof createMvtTileTransform>,
  compositeAtlas?: ReturnType<typeof buildCompositeSpriteAtlas>,
): BillboardCollection | undefined {
  const iconItems = placementGroups
    .map(group => group.icon)
    .filter((item): item is MvtSymbolIconItem => Boolean(item));
  if (!iconItems.length) {
    return undefined;
  }

  const collection = new BillboardCollection();
  collection.modelMatrix = transform.modelMatrix;

  for (const item of iconItems) {
    let image = item.image;
    let imageSubRegion = item.imageSubRegion;

    if (item.compositeKey && compositeAtlas) {
      const compositeEntry = compositeAtlas.entries.get(item.compositeKey);
      if (compositeEntry) {
        image = compositeAtlas.imageUrl;
        imageSubRegion = new BoundingRectangle(
          compositeEntry.x,
          compositeEntry.y,
          compositeEntry.width,
          compositeEntry.height,
        );
      }
    }

    item.billboard = collection.add({
      color: item.color,
      height: item.height,
      horizontalOrigin: item.horizontalOrigin,
      image,
      imageSubRegion,
      pixelOffset: item.pixelOffset,
      position: item.position,
      rotation: item.rotation,
      verticalOrigin: item.verticalOrigin,
      width: item.width,
    });
  }

  return collection;
}

function createLabelCollection(
  placementGroups: readonly MvtSymbolPlacementGroup[],
  transform: ReturnType<typeof createMvtTileTransform>,
): LabelCollection | undefined {
  const labelItems = placementGroups.flatMap(group => group.label?.items ?? []);
  if (!labelItems.length || typeof document === 'undefined') {
    return undefined;
  }

  const collection = new LabelCollection();
  collection.modelMatrix = transform.modelMatrix;

  for (const item of labelItems) {
    item.label = collection.add({
      fillColor: item.fillColor,
      font: item.font,
      horizontalOrigin: item.horizontalOrigin,
      outlineColor: item.outlineColor,
      outlineWidth: item.outlineWidth,
      pixelOffset: item.pixelOffset,
      position: item.position,
      style: item.style,
      text: item.text,
      verticalOrigin: item.verticalOrigin,
    });
  }

  return collection;
}

function createSpriteSubRegion(imageHeight: number, spriteEntry: MvtStyleSpriteEntry): BoundingRectangle {
  return new BoundingRectangle(
    spriteEntry.x,
    imageHeight - spriteEntry.y - spriteEntry.height,
    spriteEntry.width,
    spriteEntry.height,
  );
}

function estimateIconByteLength(iconCount: number): number {
  return iconCount * 192;
}

function estimateLabelByteLength(
  labelLineCount: number,
  placementGroups: readonly MvtSymbolPlacementGroup[],
): number {
  let total = 0;
  for (const item of placementGroups.flatMap(group => group.label?.items ?? [])) {
    total += 256 + item.text.length * 4 + item.font.length * 2;
  }
  return total + labelLineCount * 24;
}

function createSymbolCollisionBox(
  anchor: MvtSymbolAnchor,
  height: number,
  horizontalOrigin: HorizontalOrigin,
  pixelOffset: Cartesian2,
  padding: number,
  verticalOrigin: VerticalOrigin,
  width: number,
): { maxX: number; maxY: number; minX: number; minY: number } {
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

function createMultilineLabelItems(
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
        Cartesian3.clone(anchor.position),
        getLayerHeightOffset(layer, 'symbol-text'),
      ),
      style: label.style,
      text: line,
      verticalOrigin: label.verticalOrigin,
    });
  });

  return labelItems;
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

function resolveSymbolBoolean(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature: MvtBucketFeature,
  fallbackValue: boolean,
): boolean {
  const value = styleSet.evaluateLayoutValue(layer, propertyName, zoom, feature);
  return typeof value === 'boolean' ? value : fallbackValue;
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

function resolveSymbolIcon(
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

function resolveSymbolLabel(
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

function resolveSymbolAnchors(
  styleSet: MvtStyleSet,
  feature: MvtBucketFeature,
  extent: number,
  layer: MvtCompiledStyleLayer,
  transform: ReturnType<typeof createMvtTileTransform>,
  zoom: number,
): MvtSymbolAnchor[] {
  const placement = styleSet.evaluateLayoutValue(layer, 'symbol-placement', zoom, feature);
  const isLinePlacement = placement === 'line';
  const spacing = resolveSymbolSpacing(styleSet, layer, zoom, feature, extent);

  switch (feature.geometryType) {
    case 'Point':
      return feature.geometry.flat().map(point => createSymbolAnchor(point, 0, extent, transform));
    case 'LineString':
      return feature.geometry
        .flatMap((part) => {
          const normalizedPart = normalizePolylinePoints(part);
          if (isLinePlacement) {
            return sampleLineAnchors(normalizedPart, spacing);
          }

          const midpoint = resolveLineMidpoint(normalizedPart);
          return midpoint ? [{ angle: 0, point: midpoint }] : [];
        })
        .map(anchor => createSymbolAnchor(anchor.point, anchor.angle, extent, transform));
    case 'Polygon':
      if (isLinePlacement) {
        return feature.geometry
          .flatMap(polygon => sampleLineAnchors(normalizePolylinePoints(polygon[0] ?? []), spacing))
          .map(anchor => createSymbolAnchor(anchor.point, anchor.angle, extent, transform));
      }

      return feature.geometry
        .map(polygon => resolvePolygonAnchorPoint(polygon[0] ?? []))
        .filter((point): point is Point => Boolean(point))
        .map(point => createSymbolAnchor(point, 0, extent, transform));
  }
}

function createSymbolAnchor(
  point: Point,
  angle: number,
  extent: number,
  transform: ReturnType<typeof createMvtTileTransform>,
): MvtSymbolAnchor {
  const zoomScale = 2 ** transform.displayCoordinate.z;
  const mapScale = 1 / (512 * zoomScale);

  return {
    angle,
    mapScale,
    mapX: (transform.displayCoordinate.x + point.x / extent) / zoomScale,
    mapY: (transform.displayCoordinate.y + point.y / extent) / zoomScale,
    position: projectTilePointToLocalCartesian(point, extent, transform),
  };
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

function resolveSymbolSpacing(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
  extent: number,
): number {
  return Math.max(1, styleSet.evaluateLayoutNumber(layer, 'symbol-spacing', zoom, feature, 250))
    * getTileUnitsPerPixel(extent);
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

function resolveSymbolTranslate(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  propertyName: 'icon-translate' | 'text-translate',
  zoom: number,
  feature: MvtBucketFeature,
): Cartesian2 {
  const translateValue = styleSet.evaluatePaintValue(layer, propertyName, zoom, feature);
  if (!Array.isArray(translateValue) || translateValue.length < 2) {
    return Cartesian2.ZERO;
  }

  const [translateX, translateY] = translateValue;
  if (typeof translateX !== 'number' || typeof translateY !== 'number') {
    return Cartesian2.ZERO;
  }

  return new Cartesian2(translateX, -translateY);
}

function resolveRotationAlignment(value: unknown): 'map' | 'viewport' {
  return value === 'viewport' ? 'viewport' : 'map';
}

function resolveLineMidpoint(points: readonly Point[]): Point | undefined {
  if (points.length === 0) {
    return undefined;
  }
  if (points.length === 1) {
    return points[0];
  }

  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength <= 0) {
    return points[Math.floor(points.length / 2)];
  }

  const halfLength = totalLength * 0.5;
  let accumulatedLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = segmentLengths[index - 1];
    if (accumulatedLength + segmentLength < halfLength) {
      accumulatedLength += segmentLength;
      continue;
    }

    const ratio = segmentLength <= 0 ? 0 : (halfLength - accumulatedLength) / segmentLength;
    const start = points[index - 1];
    const end = points[index];
    return createSymbolPoint(
      start.x + (end.x - start.x) * ratio,
      start.y + (end.y - start.y) * ratio,
    );
  }

  return points[points.length - 1];
}

function resolvePolygonAnchorPoint(ring: readonly Point[]): Point | undefined {
  if (!ring.length) {
    return undefined;
  }

  let minX = ring[0].x;
  let minY = ring[0].y;
  let maxX = ring[0].x;
  let maxY = ring[0].y;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return createSymbolPoint((minX + maxX) * 0.5, (minY + maxY) * 0.5);
}

function sampleLineAnchors(
  points: readonly Point[],
  spacing: number,
): Array<{ angle: number; point: Point }> {
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [{ angle: 0, point: points[0] }];
  }

  const totalLength = computePolylineLength(points);
  if (totalLength <= 0) {
    return [{ angle: 0, point: points[Math.floor(points.length / 2)] }];
  }

  const anchors: Array<{ angle: number; point: Point }> = [];
  const normalizedSpacing = Math.max(1, spacing);
  let targetDistance = normalizedSpacing * 0.5;

  while (targetDistance < totalLength) {
    const anchor = interpolateLineAnchor(points, targetDistance);
    if (anchor) {
      anchors.push(anchor);
    }
    targetDistance += normalizedSpacing;
  }

  if (anchors.length) {
    return anchors;
  }

  const midpoint = resolveLineMidpoint(points);
  return midpoint ? [{ angle: 0, point: midpoint }] : [];
}

function computePolylineLength(points: readonly Point[]): number {
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    totalLength += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return totalLength;
}

function interpolateLineAnchor(
  points: readonly Point[],
  targetDistance: number,
): { angle: number; point: Point } | undefined {
  let accumulatedLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength <= 0) {
      continue;
    }
    if (accumulatedLength + segmentLength < targetDistance) {
      accumulatedLength += segmentLength;
      continue;
    }

    const ratio = (targetDistance - accumulatedLength) / segmentLength;
    return {
      angle: Math.atan2(-(end.y - start.y), end.x - start.x),
      point: createSymbolPoint(
        start.x + (end.x - start.x) * ratio,
        start.y + (end.y - start.y) * ratio,
      ),
    };
  }

  return undefined;
}

function createSymbolPoint(x: number, y: number): Point {
  return { x, y } as Point;
}

function warnUnsupportedSymbolLayerProperties(
  layer: MvtCompiledStyleLayer,
  warningContext: MvtWarningContext | undefined,
): void {
  if (layer.layout['text-variable-anchor'] !== undefined) {
    warnUnsupportedLayerProperty(warningContext, layer, 'layout', 'text-variable-anchor');
  }
  if (layer.paint['icon-halo-color'] !== undefined || layer.paint['icon-halo-width'] !== undefined) {
    warnUnsupportedLayerProperty(warningContext, layer, 'paint', 'icon-halo-color');
  }
}

function resolveIconTextFitPadding(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature: MvtBucketFeature,
): [number, number, number, number] {
  const value = styleSet.evaluateLayoutValue(layer, 'icon-text-fit-padding', zoom, feature);
  if (!Array.isArray(value) || value.length < 4) {
    return [0, 0, 0, 0];
  }

  const [top, right, bottom, left] = value;
  if (
    typeof top !== 'number'
    || typeof right !== 'number'
    || typeof bottom !== 'number'
    || typeof left !== 'number'
  ) {
    return [0, 0, 0, 0];
  }

  return [top, right, bottom, left];
}

function applyIconTextFit(
  icon: MvtResolvedSymbolIcon,
  label: MvtResolvedSymbolLabel,
  fit: string,
  padding: [number, number, number, number],
): MvtResolvedSymbolIcon {
  const [top, right, bottom, left] = padding;
  const textWidth = label.blockWidth + left + right;
  const textHeight = label.blockHeight + top + bottom;

  let newWidth = icon.width;
  let newHeight = icon.height;

  switch (fit) {
    case 'width':
      newWidth = textWidth;
      break;
    case 'height':
      newHeight = textHeight;
      break;
    case 'both':
      newWidth = textWidth;
      newHeight = textHeight;
      break;
    default:
      return icon;
  }

  return {
    ...icon,
    height: newHeight,
    width: newWidth,
  };
}

function withOpacity(color: Color, opacity: number): Color {
  return new Color(
    color.red,
    color.green,
    color.blue,
    color.alpha * Math.max(0, Math.min(1, opacity)),
  );
}
