import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  Bucket,
  SymbolBucketData,
} from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import type { SymbolLayerStyle } from '../../style/layer-style-resolver';
import type {
  BucketSymbolCollectionHandle,
  BucketSymbolPlacementHandle,
  BucketSymbolPlacementPartHandle,
  BucketSymbolRenderableDescriptor,
  BucketSymbolRenderableHandle,
} from './bucket-symbol-types';
import type { SymbolPlacementGrid, SymbolPlacementGridPlacement } from './symbol-placement-grid';
import type { TileCoordinate, TileNativeRectangle } from './symbol-placement-utils';
import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color as CesiumColor,
  HorizontalOrigin as CesiumHorizontalOrigin,
  VerticalOrigin as CesiumVerticalOrigin,
  LabelCollection,
} from 'cesium';
import { createFeatureFilter } from '../../style/filter-adapter';
import { createSymbolLayerStyleResolver } from '../../style/layer-style-resolver';
import { resolveStyleImage, resolveStyleImageName } from '../../style/sprite-atlas';
import { isValidTypedArray } from '../../utils/validation';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';
import {
  createSymbolPlacementKey,
  resolveIconPlacement,
  resolveSymbolPlacement,
} from './symbol-placement-resolver';
import {
  getSymbolMatchAnchor,
  getViewportLatitude,
  resolveTranslatedSymbolPosition,
} from './symbol-placement-utils';
import {
  convertHorizontalOrigin,
  convertVerticalOrigin,
  layoutFormattedSymbolContent,
  resolveColor,
  resolveIconTextFitDimensions,
  resolveLabelFont,
  resolveSymbolAnchorOffset,
  resolveSymbolRenderDecision,
  resolveSymbolRenderedText,
  resolveSymbolTextContent,
  resolveTextHaloColor,
  resolveTextHaloWidth,
  toCesiumRotation,
} from './symbol-render-utils';

export interface SymbolPlacement {
  position: Cartesian3;
  lineAngle?: number;
  featureIdentity?: number | string;
  sourceIndex: number;
  symbolStyle: SymbolLayerStyle;
  viewportLatitude?: number;
}

interface SymbolLayoutCacheEntry {
  formattedLayout?: ReturnType<typeof layoutFormattedSymbolContent>;
  iconFit?: {
    height: number;
    width: number;
  };
  iconImage?: ReturnType<typeof resolveStyleImage>;
  renderedText: string;
}

const symbolLayoutCacheByStyle = new WeakMap<StyleSpecification, Map<number, Map<string, SymbolLayoutCacheEntry>>>();

export function createSymbolCollections(
  bucket: Bucket,
  layerId: string,
  layersById: ReadonlyMap<string, StyleSpecification['layers'][number]>,
  featureStateResolver: FeatureStateResolver | undefined,
  style: StyleSpecification,
  sourceId: string,
  zoom: number,
  tileCoordinate: TileCoordinate,
  styleEpoch: number,
  tileWidth: number,
  tileRectangle: TileNativeRectangle,
  placementGrid: SymbolPlacementGrid,
): {
  collections: BucketSymbolCollectionHandle[];
  placements: BucketSymbolPlacementHandle[];
} {
  const data = bucket.data as SymbolBucketData;

  if (!isValidTypedArray(data.positions, Float64Array)
    || !isValidTypedArray(data.featureIds, Float32Array)
    || data.positions.length === 0) {
    return {
      collections: [],
      placements: [],
    };
  }

  const layer = layersById.get(layerId);
  if (!layer || layer.type !== 'symbol') {
    return {
      collections: [],
      placements: [],
    };
  }

  const resolveStyle = createSymbolLayerStyleResolver(layer);
  const filter = createFeatureFilter(layer.filter);
  const placements: SymbolPlacement[] = [];
  const bucketPlacements: BucketSymbolPlacementHandle[] = [];

  const pointCount = data.positions.length / 3;

  for (let index = 0; index < pointCount; index += 1) {
    const x = data.positions[index * 3];
    const y = data.positions[index * 3 + 1];
    const z = data.positions[index * 3 + 2];

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const featureId = data.featureIds[index];
    const featureIndex = getFeatureIndexEntry(
      bucket.featureIndex.entries,
      featureId,
    );
    const featureState = featureStateResolver?.({
      id: featureIndex?.id,
      sourceId,
      sourceLayer: bucket.sourceLayer,
    });
    const context = createPrimitiveStyleContext(featureIndex, {
      featureState,
      geometryType: featureIndex?.type === 'line' ? 'LineString' : 'Point',
      zoom,
    });

    if (context.feature && !filter(context)) {
      continue;
    }

    const symbolStyle = resolveStyle(context);
    const position = Cartesian3.fromElements(x, y, z);
    placements.push({
      featureIdentity: featureIndex?.id ?? index,
      position,
      lineAngle: data.lineAngles?.[index],
      sourceIndex: index,
      symbolStyle,
      viewportLatitude: getViewportLatitude(position),
    });
  }

  if (placements.length === 0) {
    return {
      collections: [],
      placements: [],
    };
  }

  placements.sort(compareSymbolPlacements);

  const labelCollection = new LabelCollection();
  const billboardCollection = new BillboardCollection();
  const labelCollectionHandle: BucketSymbolCollectionHandle = {
    byteLength: 0,
    collection: labelCollection,
    itemCount: 0,
    layerId,
  };
  const billboardCollectionHandle: BucketSymbolCollectionHandle = {
    byteLength: 0,
    collection: billboardCollection,
    itemCount: 0,
    layerId,
  };
  let labelCount = 0;
  let billboardCount = 0;

  for (const placement of placements) {
    const symbolStyle = placement.symbolStyle;
    const symbolText = resolveSymbolTextContent(
      symbolStyle.textField,
      symbolStyle.textTransform,
    );
    const layoutCacheKey = createSymbolLayoutCacheKey(
      layerId,
      symbolStyle,
      symbolText,
    );
    const layoutState = getSymbolLayoutCacheEntry(style, styleEpoch, layoutCacheKey, () => {
      const iconImage = symbolStyle.iconImage
        ? resolveStyleImage(style, symbolStyle.iconImage)
        : undefined;
      const formattedLayout = symbolText.sections?.length
        ? layoutFormattedSymbolContent(
            symbolStyle,
            symbolText.sections,
            image => resolveStyleImage(style, image ?? undefined),
          )
        : undefined;
      return {
        formattedLayout,
        iconFit: iconImage
          ? resolveIconTextFitDimensions(symbolStyle, symbolText, iconImage, formattedLayout)
          : undefined,
        iconImage,
        renderedText: resolveSymbolRenderedText(symbolStyle, symbolText.text),
      };
    });
    const {
      formattedLayout,
      iconFit,
      iconImage,
      renderedText: renderedSymbolText,
    } = layoutState;
    const textTranslatePlacement = resolveTranslatedSymbolPosition(
      placement.position,
      symbolStyle.textTranslate,
      symbolStyle.textTranslateAnchor,
      tileRectangle,
      tileWidth,
    );
    const iconTranslatePlacement = resolveTranslatedSymbolPosition(
      placement.position,
      symbolStyle.iconTranslate,
      symbolStyle.iconTranslateAnchor,
      tileRectangle,
      tileWidth,
    );
    const matchPosition = symbolStyle.textField
      ? textTranslatePlacement.position
      : iconTranslatePlacement.position;
    const anchor = getSymbolMatchAnchor(matchPosition);
    const fittedIconImage = iconFit && iconImage
      ? {
          ...iconImage,
          height: iconFit.height,
          width: iconFit.width,
        }
      : iconImage;
    const basePlacement = {
      anchorX: anchor.anchorX,
      anchorY: anchor.anchorY,
      key: createSymbolPlacementKey(sourceId, layerId, symbolStyle, symbolText),
      layerId,
    };
    const textPlacement = symbolStyle.textField
      ? resolveSymbolPlacement(
          symbolStyle,
          symbolText,
          undefined,
          tileWidth,
          zoom,
          tileCoordinate,
          placementGrid,
          placement.lineAngle,
          basePlacement,
          textTranslatePlacement.viewportOffset,
          formattedLayout,
        )
      : undefined;
    const iconPlacement = fittedIconImage
      ? resolveIconPlacement(
          symbolStyle,
          fittedIconImage,
          tileWidth,
          zoom,
          tileCoordinate,
          placementGrid,
          basePlacement,
          iconTranslatePlacement.viewportOffset,
        )
      : undefined;

    const renderDecision = resolveSymbolRenderDecision(
      symbolStyle,
      textPlacement,
      iconPlacement,
      iconImage,
    );
    if (!renderDecision) {
      continue;
    }
    const { shouldRenderText, shouldRenderIcon } = renderDecision;
    const collisionParts: BucketSymbolPlacementPartHandle[] = [];
    const bucketPlacement: BucketSymbolPlacementHandle = {
      ...basePlacement,
      collisionParts,
      lineAngle: placement.lineAngle,
      renderables: [],
      sortByViewportY: shouldSortByViewportY(symbolStyle),
      sortKeyIsConstant: symbolStyle.sortKeyIsConstant,
      sortKey: symbolStyle.sortKey,
      sourceIndex: placement.sourceIndex,
      sourceLayer: bucket.sourceLayer,
      viewportLatitude: placement.viewportLatitude,
      layerId,
      zOrder: symbolStyle.zOrder,
    };
    const placementGroupKey = createSymbolPlacementGroupKey(
      sourceId,
      tileCoordinate.level,
      tileCoordinate.x,
      tileCoordinate.y,
      layerId,
      placement.sourceIndex,
    );

    if (shouldRenderIcon && fittedIconImage && iconPlacement) {
      const renderableDescriptors: BucketSymbolRenderableDescriptor[] = [{
        collection: billboardCollection,
        collectionHandle: billboardCollectionHandle,
        options: {
          color: resolveColor(
            symbolStyle.iconColor,
            symbolStyle.iconOpacity,
            CesiumColor.WHITE,
          ),
          disableDepthTestDistance: 0,
          height: iconFit?.height,
          horizontalOrigin: convertHorizontalOrigin(
            iconPlacement.iconAnchor,
          ),
          image: fittedIconImage.image,
          pixelOffset: iconPlacement.iconOffset
            ? new Cartesian2(iconPlacement.iconOffset[0], iconPlacement.iconOffset[1])
            : undefined,
          position: iconTranslatePlacement.position,
          rotation: toCesiumRotation(symbolStyle.iconRotate),
          scale: iconFit ? 1 : (symbolStyle.iconSize ?? 1),
          verticalOrigin: convertVerticalOrigin(
            iconPlacement.iconAnchor,
          ),
          width: iconFit?.width,
        },
      }];
      billboardCount += 1;
      appendPlacementPart(bucketPlacement, collisionParts, placementGrid, {
        collision: iconPlacement.collision,
        groupKey: placementGroupKey,
        kind: 'icon',
        renderableDescriptors,
        renderables: [],
        textAnchor: iconPlacement.iconAnchor,
        textOffset: iconPlacement.iconOffset,
      }, {
        anchorX: basePlacement.anchorX,
        anchorY: basePlacement.anchorY,
        collision: iconPlacement.collision,
        groupKey: placementGroupKey,
        key: basePlacement.key,
        layerId: basePlacement.layerId,
        lineAngle: placement.lineAngle,
      });
    }

    if (shouldRenderText && textPlacement) {
      const renderableDescriptors: BucketSymbolRenderableDescriptor[] = [];
      if (formattedLayout) {
        const groupOffset = resolveFormattedGroupPixelOffset(
          textPlacement.textAnchor,
          textPlacement.textOffset,
          formattedLayout.width,
          formattedLayout.height,
        );

        for (const section of formattedLayout.sections) {
          const pixelOffset = new Cartesian2(
            groupOffset.x + section.offsetX,
            groupOffset.y + section.offsetY,
          );

          if (section.kind === 'image' && section.image) {
            renderableDescriptors.push({
              collection: billboardCollection,
              collectionHandle: billboardCollectionHandle,
              options: {
                disableDepthTestDistance: 0,
                height: section.height,
                horizontalOrigin: CesiumHorizontalOrigin.LEFT,
                image: section.image.image,
                pixelOffset,
                position: textTranslatePlacement.position,
                scale: 1,
                verticalOrigin: CesiumVerticalOrigin.TOP,
                width: section.width,
              },
            });
            billboardCount += 1;
            continue;
          }

          if (!section.text.trim()) {
            continue;
          }

          const sectionFontSize = (symbolStyle.textSize ?? 16) * section.scale;
          renderableDescriptors.push({
            collection: labelCollection,
            collectionHandle: labelCollectionHandle,
            options: {
              disableDepthTestDistance: 0,
              fillColor: resolveColor(
                section.textColor ?? symbolStyle.textColor,
                symbolStyle.textOpacity,
                CesiumColor.BLACK,
              ),
              font: resolveLabelFont(symbolStyle, section.fontStack, sectionFontSize),
              horizontalOrigin: CesiumHorizontalOrigin.LEFT,
              outlineColor: resolveTextHaloColor(symbolStyle),
              outlineWidth: resolveTextHaloWidth(symbolStyle),
              pixelOffset,
              position: textTranslatePlacement.position,
              scale: 1,
              text: section.text,
              verticalOrigin: CesiumVerticalOrigin.TOP,
            },
          });
          labelCount += 1;
        }
      }
      else {
        renderableDescriptors.push({
          collection: labelCollection,
          collectionHandle: labelCollectionHandle,
          options: {
            disableDepthTestDistance: 0,
            fillColor: resolveColor(
              symbolStyle.textColor,
              symbolStyle.textOpacity,
              CesiumColor.BLACK,
            ),
            font: resolveLabelFont(symbolStyle),
            horizontalOrigin: convertHorizontalOrigin(textPlacement.textAnchor),
            outlineColor: resolveTextHaloColor(symbolStyle),
            outlineWidth: resolveTextHaloWidth(symbolStyle),
            pixelOffset: textPlacement.textOffset
              ? new Cartesian2(textPlacement.textOffset[0], textPlacement.textOffset[1])
              : undefined,
            position: textTranslatePlacement.position,
            scale: 1,
            text: renderedSymbolText,
            verticalOrigin: convertVerticalOrigin(textPlacement.textAnchor),
          },
        });
        labelCount += 1;
      }

      appendPlacementPart(bucketPlacement, collisionParts, placementGrid, {
        collision: textPlacement.collision,
        groupKey: placementGroupKey,
        kind: 'text',
        renderableDescriptors,
        renderables: [],
        textAnchor: textPlacement.textAnchor,
        textOffset: textPlacement.textOffset,
      }, {
        anchorX: basePlacement.anchorX,
        anchorY: basePlacement.anchorY,
        collision: textPlacement.collision,
        groupKey: placementGroupKey,
        key: basePlacement.key,
        layerId: basePlacement.layerId,
        lineAngle: placement.lineAngle,
      });
    }

    if (bucketPlacement.collisionParts.length > 0) {
      bucketPlacements.push(bucketPlacement);
    }
  }

  const collections: BucketSymbolCollectionHandle[] = [];

  if (billboardCount > 0) {
    billboardCollectionHandle.byteLength = billboardCount * 100;
    collections.push(billboardCollectionHandle);
  }
  else {
    billboardCollection.destroy();
  }

  if (labelCount > 0) {
    labelCollectionHandle.byteLength = labelCount * 100;
    collections.push(labelCollectionHandle);
  }
  else {
    labelCollection.destroy();
  }

  return {
    collections,
    placements: bucketPlacements,
  };
}

function appendPlacementPart(
  bucketPlacement: BucketSymbolPlacementHandle,
  collisionParts: BucketSymbolPlacementPartHandle[],
  placementGrid: SymbolPlacementGrid,
  part: BucketSymbolPlacementPartHandle,
  gridPlacement: SymbolPlacementGridPlacement,
): void {
  if (part.renderableDescriptors.length === 0) {
    return;
  }

  collisionParts.push(part);
  bucketPlacement.renderables.push(...part.renderables);

  if (gridPlacement.collision?.blocksOtherSymbols) {
    placementGrid.insert(gridPlacement);
  }
}

export function materializeSymbolCollections(
  handle: {
    materializationCursor: number;
    placements: BucketSymbolPlacementHandle[];
  },
  visible: boolean,
  placementBudget: number = Number.POSITIVE_INFINITY,
): number {
  if (handle.materializationCursor >= handle.placements.length || placementBudget <= 0) {
    return 0;
  }

  const maxPlacements = Number.isFinite(placementBudget)
    ? Math.max(0, Math.trunc(placementBudget))
    : handle.placements.length - handle.materializationCursor;
  let processedCount = 0;

  while (
    handle.materializationCursor < handle.placements.length
    && processedCount < maxPlacements
  ) {
    const placement = handle.placements[handle.materializationCursor];
    if (!placement) {
      handle.materializationCursor += 1;
      continue;
    }

    for (const part of placement.collisionParts) {
      if (part.renderableDescriptors.length === 0) {
        continue;
      }

      for (const descriptor of part.renderableDescriptors) {
        const itemIndex = descriptor.collectionHandle.itemCount;
        const item = descriptor.collection.add({
          ...descriptor.options,
          show: visible,
        } as never);
        const renderable: BucketSymbolRenderableHandle = {
          collection: descriptor.collection,
          item,
          index: itemIndex,
          visible,
        };
        descriptor.collectionHandle.itemCount += 1;
        part.renderables.push(renderable);
        placement.renderables.push(renderable);
      }
    }

    handle.materializationCursor += 1;
    processedCount += 1;
  }

  return processedCount;
}

function createSymbolPlacementGroupKey(
  sourceId: string,
  level: number,
  tileX: number,
  tileY: number,
  layerId: string,
  sourceIndex: number,
): string {
  return `${sourceId}/${level}/${tileX}/${tileY}|${layerId}|${sourceIndex}`;
}

function createSymbolLayoutCacheKey(
  layerId: string,
  symbolStyle: SymbolLayerStyle,
  symbolText: ReturnType<typeof resolveSymbolTextContent>,
): string {
  const sections = symbolText.sections?.map(section => [
    section.image?.name ?? '',
    section.scale,
    section.fontStack?.join(',') ?? '',
    section.text,
    section.textColor ?? '',
    section.verticalAlign,
  ].join(':')).join('\u0001') ?? '';

  return [
    layerId,
    symbolText.key,
    symbolText.text,
    sections,
    symbolStyle.iconImage ? resolveStyleImageName(symbolStyle.iconImage) ?? '' : '',
    symbolStyle.iconPadding ?? '',
    symbolStyle.iconSize ?? '',
    symbolStyle.iconTextFit ?? '',
    symbolStyle.iconTextFitPadding?.join(',') ?? '',
    symbolStyle.textLetterSpacing ?? '',
    symbolStyle.textLineHeight ?? '',
    symbolStyle.textMaxWidth ?? '',
    symbolStyle.textPadding ?? '',
    symbolStyle.textSize ?? '',
    symbolStyle.textTransform ?? '',
  ].join('\u0001');
}

function getSymbolLayoutCacheEntry(
  style: StyleSpecification,
  styleEpoch: number,
  cacheKey: string,
  factory: () => SymbolLayoutCacheEntry,
): SymbolLayoutCacheEntry {
  let styleCache = symbolLayoutCacheByStyle.get(style);
  if (!styleCache) {
    styleCache = new Map<number, Map<string, SymbolLayoutCacheEntry>>();
    symbolLayoutCacheByStyle.set(style, styleCache);
  }

  let epochCache = styleCache.get(styleEpoch);
  if (!epochCache) {
    epochCache = new Map<string, SymbolLayoutCacheEntry>();
    styleCache.set(styleEpoch, epochCache);
  }

  const cached = epochCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const created = factory();
  epochCache.set(cacheKey, created);
  return created;
}

export function compareSymbolPlacements(
  left: SymbolPlacement,
  right: SymbolPlacement,
): number {
  if (
    left.symbolStyle.zOrder !== 'viewport-y'
    && right.symbolStyle.zOrder !== 'viewport-y'
    && (left.symbolStyle.sortKey !== undefined || right.symbolStyle.sortKey !== undefined)
  ) {
    const leftSortKey = left.symbolStyle.sortKey ?? 0;
    const rightSortKey = right.symbolStyle.sortKey ?? 0;
    if (leftSortKey !== rightSortKey) {
      return leftSortKey - rightSortKey;
    }
  }

  if (shouldSortByViewportY(left.symbolStyle) && shouldSortByViewportY(right.symbolStyle)) {
    const leftLatitude = left.viewportLatitude ?? getViewportLatitude(left.position);
    const rightLatitude = right.viewportLatitude ?? getViewportLatitude(right.position);
    if (leftLatitude !== rightLatitude) {
      return rightLatitude - leftLatitude;
    }
  }

  return left.sourceIndex - right.sourceIndex;
}

function shouldSortByViewportY(
  symbolStyle: SymbolLayerStyle,
): boolean {
  if (symbolStyle.zOrder === 'viewport-y') {
    return true;
  }

  if (symbolStyle.zOrder === 'auto') {
    const sortKeyIsConstant = symbolStyle.sortKeyIsConstant ?? true;
    if (sortKeyIsConstant) {
      const canOverlap = symbolStyle.textOverlap === 'always'
        || symbolStyle.textOverlap === 'cooperative'
        || symbolStyle.textAllowOverlap
        || symbolStyle.textIgnorePlacement
        || symbolStyle.iconOverlap === 'always'
        || symbolStyle.iconOverlap === 'cooperative'
        || symbolStyle.iconAllowOverlap
        || symbolStyle.iconIgnorePlacement;
      if (canOverlap) {
        return true;
      }
    }
  }

  return false;
}

function resolveFormattedGroupPixelOffset(
  anchor: SymbolLayerStyle['textAnchor'],
  offset: [number, number] | undefined,
  width: number,
  height: number,
): Cartesian2 {
  const anchorOffset = resolveSymbolAnchorOffset(anchor, width, height);
  return new Cartesian2(
    (offset?.[0] ?? 0) + anchorOffset.x - (width / 2),
    (offset?.[1] ?? 0) + anchorOffset.y - (height / 2),
  );
}
