import type { DisplayFeatureCache } from '../mesh/display-feature';
import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer, StyleSpriteEntry } from '../types';
import type { WarningContext } from '../warning-context';
import type { SymbolCollisionIndex } from './symbol-collision';
import type { CompositeSpriteItem } from './symbol-composite';
import type { ResolvedSymbolIcon, ResolvedSymbolLabel, SymbolAnchor, SymbolCollisionBox, SymbolIconItem, SymbolLabelItem, SymbolPlacementGroup } from './symbol-types';
import type { createTileTransform } from './tile-transform';
import { BillboardCollection, BoundingRectangle, Cartesian2, Cartesian3, Math as CesiumMath, Color, HorizontalOrigin, LabelCollection, LabelStyle, VerticalOrigin } from '@cesium/engine';
import Point from '@mapbox/point-geometry';
import { getClippedDisplayFeature } from '../mesh/display-feature';
import { normalizePolylinePoints } from '../mesh/geometry-normalize';
import { warnOnce, warnUnsupportedLayerProperty } from '../warning-context';
import { getLayerHeightOffset, liftLocalPosition } from './layer-height';
import { getTileUnitsPerPixel } from './style-geometry';
import { buildCompositeSpriteAtlas, createCompositeCacheKey, getOrCreateCompositeSpriteEntry } from './symbol-composite';
import { extractPlainTextValue, resolveTextBlock } from './symbol-text';
import { projectTilePointToLocalCartesian } from './tile-transform';

export interface TileRenderableLike {
  byteLength: number;
  destroy: () => void;
  update: (frameState: unknown, collisionIndex?: SymbolCollisionIndex) => void;
}

export function createSymbolRenderable(
  styleSet: StyleSet,
  features: readonly BucketFeature[],
  extent: number,
  layer: CompiledStyleLayer,
  zoom: number,
  transform: ReturnType<typeof createTileTransform>,
  collisionIndex?: SymbolCollisionIndex,
  displayFeatureCache?: DisplayFeatureCache,
  warningContext?: WarningContext,
): TileRenderableLike | undefined {
  warnUnsupportedSymbolLayerProperties(layer, warningContext);

  const placementGroups: SymbolPlacementGroup[] = [];
  let iconCandidateCount = 0;
  let labelLineCount = 0;
  const compositeItems: CompositeSpriteItem[] = [];
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

  const zOrder = resolveZOrderMode(styleSet.evaluateLayoutValue(layer, 'symbol-z-order', zoom));
  const hasSortKey = layer.layout['symbol-sort-key'] !== undefined;

  return {
    byteLength,
    destroy: () => {
      billboardCollection?.destroy();
      labelCollection?.destroy();
    },
    update: (frameState: unknown, nextCollisionIndex = collisionIndex) => {
      applyPlacementVisibility(placementGroups, nextCollisionIndex, zOrder, hasSortKey);

      if (!canUpdateCesiumCollections(frameState)) {
        return;
      }

      (billboardCollection as unknown as { update: (state: unknown) => void } | undefined)?.update(frameState);
      (labelCollection as unknown as { update: (state: unknown) => void } | undefined)?.update(frameState);
    },
  };
}

function resolveZOrderMode(value: unknown): ZOrderMode {
  if (value === 'viewport-y' || value === 'source') {
    return value;
  }
  return 'auto';
}

function createSymbolPlacementGroups(
  anchors: readonly SymbolAnchor[],
  feature: BucketFeature,
  layer: CompiledStyleLayer,
  styleSet: StyleSet,
  zoom: number,
  warningContext: WarningContext | undefined,
): SymbolPlacementGroup[] {
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
  const placementGroups: SymbolPlacementGroup[] = [];

  const labelText = resolvedLabel?.lines.join('\n');

  for (const anchor of anchors) {
    const placementGroup: SymbolPlacementGroup = {
      layerId: layer.id,
      text: labelText,
    };
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

type ZOrderMode = 'auto' | 'source' | 'viewport-y';

function applyPlacementVisibility(
  placementGroups: readonly SymbolPlacementGroup[],
  collisionIndex?: SymbolCollisionIndex,
  zOrder: ZOrderMode = 'auto',
  hasSortKey: boolean = false,
): number {
  let visiblePlacementCount = 0;

  const sortedGroups = sortPlacementGroups(placementGroups, collisionIndex, zOrder, hasSortKey);

  for (const placementGroup of sortedGroups) {
    const collisionBox = placementGroup.icon?.collisionBox
      ?? placementGroup.label?.collisionBox;

    if (!collisionBox) {
      setPlacementGroupVisible(placementGroup, false);
      continue;
    }

    const image = placementGroup.icon?.image;

    if (collisionIndex?.isAlreadyPlaced(
      collisionBox.longitude,
      collisionBox.latitude,
      placementGroup.layerId,
      placementGroup.text,
      image,
    )) {
      setPlacementGroupVisible(placementGroup, false);
      continue;
    }

    const visible = !collisionIndex || !collidesWithPlacementGroup(placementGroup, collisionIndex);
    if (visible) {
      insertPlacementCollisionBoxes(placementGroup, collisionIndex);
      collisionIndex?.markAsPlaced(
        collisionBox.longitude,
        collisionBox.latitude,
        placementGroup.layerId,
        placementGroup.text,
        image,
      );
      visiblePlacementCount += 1;
    }

    setPlacementGroupVisible(placementGroup, visible);
  }

  return visiblePlacementCount;
}

function sortPlacementGroups(
  placementGroups: readonly SymbolPlacementGroup[],
  collisionIndex: SymbolCollisionIndex | undefined,
  zOrder: ZOrderMode,
  hasSortKey: boolean,
): readonly SymbolPlacementGroup[] {
  if (!collisionIndex || !collisionIndex.hasScene()) {
    return placementGroups;
  }

  const shouldSortByViewportY = zOrder === 'viewport-y' || (zOrder === 'auto' && !hasSortKey);

  if (!shouldSortByViewportY) {
    return placementGroups;
  }

  return [...placementGroups].sort((a, b) => {
    const screenYA = calculatePlacementScreenY(a, collisionIndex);
    const screenYB = calculatePlacementScreenY(b, collisionIndex);
    return screenYA - screenYB;
  });
}

function calculatePlacementScreenY(
  placementGroup: SymbolPlacementGroup,
  collisionIndex: SymbolCollisionIndex,
): number {
  const position = placementGroup.icon?.collisionBox?.position
    ?? placementGroup.label?.collisionBox?.position;

  if (position) {
    return collisionIndex.calculateScreenY(position);
  }

  return 0;
}

function collidesWithPlacementGroup(
  placementGroup: SymbolPlacementGroup,
  collisionIndex: SymbolCollisionIndex,
): boolean {
  return Boolean(
    (placementGroup.icon?.collisionBox && collisionIndex.collides(placementGroup.icon.collisionBox))
    || (placementGroup.label?.collisionBox && collisionIndex.collides(placementGroup.label.collisionBox)),
  );
}

function insertPlacementCollisionBoxes(
  placementGroup: SymbolPlacementGroup,
  collisionIndex?: SymbolCollisionIndex,
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
  placementGroup: SymbolPlacementGroup,
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
  placementGroups: readonly SymbolPlacementGroup[],
  transform: ReturnType<typeof createTileTransform>,
  compositeAtlas?: ReturnType<typeof buildCompositeSpriteAtlas>,
): BillboardCollection | undefined {
  const iconItems = placementGroups
    .map(group => group.icon)
    .filter((item): item is SymbolIconItem => Boolean(item));
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
  placementGroups: readonly SymbolPlacementGroup[],
  transform: ReturnType<typeof createTileTransform>,
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

function createSpriteSubRegion(imageHeight: number, spriteEntry: StyleSpriteEntry): BoundingRectangle {
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
  placementGroups: readonly SymbolPlacementGroup[],
): number {
  let total = 0;
  for (const item of placementGroups.flatMap(group => group.label?.items ?? [])) {
    total += 256 + item.text.length * 4 + item.font.length * 2;
  }
  return total + labelLineCount * 24;
}

function createSymbolCollisionBox(
  anchor: SymbolAnchor,
  height: number,
  horizontalOrigin: HorizontalOrigin,
  pixelOffset: Cartesian2,
  padding: number,
  verticalOrigin: VerticalOrigin,
  width: number,
): SymbolCollisionBox {
  const offsetX = pixelOffset.x * anchor.mapScale;
  const offsetY = pixelOffset.y * anchor.mapScale;
  const widthInMapUnits = width * anchor.mapScale;
  const heightInMapUnits = height * anchor.mapScale;
  const paddingInMapUnits = Math.max(0, padding) * anchor.mapScale;

  const centerX = anchor.mapX + offsetX;
  const centerY = anchor.mapY + offsetY;

  const longitude = centerX * 360 - 180;
  const latitude = Math.atan(Math.sinh(centerY * Math.PI)) * 180 / Math.PI;

  return {
    height,
    horizontalOrigin,
    latitude,
    longitude,
    padding,
    pixelOffset,
    position: Cartesian3.clone(anchor.position),
    tileMaxX: centerX + widthInMapUnits * 0.5 + paddingInMapUnits,
    tileMaxY: centerY + heightInMapUnits * 0.5 + paddingInMapUnits,
    tileMinX: centerX - widthInMapUnits * 0.5 - paddingInMapUnits,
    tileMinY: centerY - heightInMapUnits * 0.5 - paddingInMapUnits,
    verticalOrigin,
    width,
  };
}

function createMultilineLabelItems(
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

function resolveIconColor(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  spriteEntry: StyleSpriteEntry,
  zoom: number,
  feature: BucketFeature,
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
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  propertyName: string,
  zoom: number,
  feature: BucketFeature,
  fallbackValue: boolean,
): boolean {
  const value = styleSet.evaluateLayoutValue(layer, propertyName, zoom, feature);
  return typeof value === 'boolean' ? value : fallbackValue;
}

function resolveIconPixelOffset(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
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
  spriteEntry: StyleSpriteEntry,
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

function resolveSymbolIcon(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  warningContext: WarningContext | undefined,
): ResolvedSymbolIcon | undefined {
  const atlas = styleSet.spriteAtlas;
  if (!atlas) {
    warnOnce(
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
    warnOnce(
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

function resolveSymbolIconName(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
): string | undefined {
  const iconImage = styleSet.evaluateLayoutValue(layer, 'icon-image', zoom, feature);
  if (!iconImage) {
    return undefined;
  }

  const iconName = String(iconImage).trim();
  return iconName || undefined;
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

function resolveSymbolTranslate(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  propertyName: 'icon-translate' | 'text-translate',
  zoom: number,
  feature: BucketFeature,
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

function withOpacity(color: Color, opacity: number): Color {
  return new Color(
    color.red,
    color.green,
    color.blue,
    color.alpha * Math.max(0, Math.min(1, opacity)),
  );
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

function resolveIconTextFitPadding(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
): [number, number, number, number] {
  const padding = styleSet.evaluateLayoutValue(layer, 'icon-text-fit-padding', zoom, feature);
  if (Array.isArray(padding) && padding.length >= 4) {
    return padding.map(v => typeof v === 'number' ? v : 0) as [number, number, number, number];
  }
  return [0, 0, 0, 0];
}

function applyIconTextFit(
  icon: ResolvedSymbolIcon,
  label: ResolvedSymbolLabel,
  fit: string,
  padding: [number, number, number, number],
): ResolvedSymbolIcon {
  const [top, right, bottom, left] = padding;
  const paddedTextWidth = label.blockWidth + left + right;
  const paddedTextHeight = label.blockHeight + top + bottom;

  let { height, width } = icon;
  switch (fit) {
    case 'width':
      width = paddedTextWidth;
      break;
    case 'height':
      height = paddedTextHeight;
      break;
    case 'both':
      width = paddedTextWidth;
      height = paddedTextHeight;
      break;
  }

  return {
    ...icon,
    height,
    width,
  };
}

function resolveSymbolAnchors(
  styleSet: StyleSet,
  feature: BucketFeature,
  extent: number,
  layer: CompiledStyleLayer,
  transform: ReturnType<typeof createTileTransform>,
  zoom: number,
): SymbolAnchor[] {
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
  transform: ReturnType<typeof createTileTransform>,
): SymbolAnchor {
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

function resolveSymbolSpacing(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  extent: number,
): number {
  return Math.max(1, styleSet.evaluateLayoutNumber(layer, 'symbol-spacing', zoom, feature, 250))
    * getTileUnitsPerPixel(extent);
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
    return new Point(
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

  return new Point((minX + maxX) * 0.5, (minY + maxY) * 0.5);
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

    if (accumulatedLength + segmentLength < targetDistance) {
      accumulatedLength += segmentLength;
      continue;
    }

    const ratio = segmentLength <= 0 ? 0 : (targetDistance - accumulatedLength) / segmentLength;
    return {
      angle: Math.atan2(-(end.y - start.y), end.x - start.x),
      point: new Point(
        start.x + (end.x - start.x) * ratio,
        start.y + (end.y - start.y) * ratio,
      ),
    };
  }

  return undefined;
}

function warnUnsupportedSymbolLayerProperties(
  layer: CompiledStyleLayer,
  warningContext: WarningContext | undefined,
): void {
  if (layer.layout['symbol-placement'] === 'line' && layer.layout['symbol-avoid-edges']) {
    warnUnsupportedLayerProperty(warningContext, layer, 'layout', 'symbol-avoid-edges');
  }
}
