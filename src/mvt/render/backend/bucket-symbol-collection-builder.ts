import type { StyleSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
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
import { resolveStyleImage } from '../../style/sprite-atlas';
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
  sourceIndex: number;
  symbolStyle: SymbolLayerStyle;
  viewportLatitude?: number;
}

export function createSymbolCollections(
  bucket: Bucket,
  layerId: string,
  layersById: Map<string, SymbolLayerSpecification>,
  featureStateResolver: FeatureStateResolver | undefined,
  style: StyleSpecification,
  sourceId: string,
  zoom: number,
  tileCoordinate: TileCoordinate,
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
  if (!layer) {
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
  let labelCount = 0;
  let billboardCount = 0;

  for (const placement of placements) {
    const symbolStyle = placement.symbolStyle;
    const symbolText = resolveSymbolTextContent(
      symbolStyle.textField,
      symbolStyle.textTransform,
    );
    const formattedLayout = symbolText.sections?.length
      ? layoutFormattedSymbolContent(
          symbolStyle,
          symbolText.sections,
          image => resolveStyleImage(style, image ?? undefined),
        )
      : undefined;
    const renderedSymbolText = resolveSymbolRenderedText(symbolStyle, symbolText.text);
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
    const iconImage = symbolStyle.iconImage
      ? resolveStyleImage(style, symbolStyle.iconImage)
      : undefined;
    const iconFit = iconImage
      ? resolveIconTextFitDimensions(symbolStyle, symbolText, iconImage, formattedLayout)
      : undefined;
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
      const renderables: BucketSymbolRenderableHandle[] = [];
      billboardCollection.add({
        color: resolveColor(
          symbolStyle.iconColor,
          symbolStyle.iconOpacity,
          CesiumColor.WHITE,
        ),
        horizontalOrigin: convertHorizontalOrigin(
          iconPlacement.iconAnchor,
        ),
        image: fittedIconImage.image,
        height: iconFit?.height,
        rotation: toCesiumRotation(symbolStyle.iconRotate),
        pixelOffset: iconPlacement.iconOffset
          ? new Cartesian2(iconPlacement.iconOffset[0], iconPlacement.iconOffset[1])
          : undefined,
        disableDepthTestDistance: 0,
        position: iconTranslatePlacement.position,
        scale: iconFit ? 1 : (symbolStyle.iconSize ?? 1),
        show: true,
        width: iconFit?.width,
        verticalOrigin: convertVerticalOrigin(
          iconPlacement.iconAnchor,
        ),
      });
      renderables.push({
        collection: billboardCollection,
        index: billboardCount,
      });
      billboardCount += 1;
      appendPlacementPart(bucketPlacement, collisionParts, placementGrid, {
        collision: iconPlacement.collision,
        groupKey: placementGroupKey,
        kind: 'icon',
        renderables,
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
      const renderables: BucketSymbolRenderableHandle[] = [];
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
            billboardCollection.add({
              horizontalOrigin: CesiumHorizontalOrigin.LEFT,
              image: section.image.image,
              height: section.height,
              pixelOffset,
              disableDepthTestDistance: 0,
              position: textTranslatePlacement.position,
              scale: 1,
              show: true,
              width: section.width,
              verticalOrigin: CesiumVerticalOrigin.TOP,
            });
            renderables.push({
              collection: billboardCollection,
              index: billboardCount,
            });
            billboardCount += 1;
            continue;
          }

          if (!section.text.trim()) {
            continue;
          }

          const sectionFontSize = (symbolStyle.textSize ?? 16) * section.scale;
          labelCollection.add({
            fillColor: resolveColor(
              section.textColor ?? symbolStyle.textColor,
              symbolStyle.textOpacity,
              CesiumColor.BLACK,
            ),
            outlineColor: resolveTextHaloColor(symbolStyle),
            outlineWidth: resolveTextHaloWidth(symbolStyle),
            font: resolveLabelFont(symbolStyle, section.fontStack, sectionFontSize),
            horizontalOrigin: CesiumHorizontalOrigin.LEFT,
            pixelOffset,
            disableDepthTestDistance: 0,
            position: textTranslatePlacement.position,
            scale: 1,
            show: true,
            text: section.text,
            verticalOrigin: CesiumVerticalOrigin.TOP,
          });
          renderables.push({
            collection: labelCollection,
            index: labelCount,
          });
          labelCount += 1;
        }
      }
      else {
        labelCollection.add({
          fillColor: resolveColor(
            symbolStyle.textColor,
            symbolStyle.textOpacity,
            CesiumColor.BLACK,
          ),
          outlineColor: resolveTextHaloColor(symbolStyle),
          outlineWidth: resolveTextHaloWidth(symbolStyle),
          font: resolveLabelFont(symbolStyle),
          horizontalOrigin: convertHorizontalOrigin(textPlacement.textAnchor),
          pixelOffset: textPlacement.textOffset
            ? new Cartesian2(textPlacement.textOffset[0], textPlacement.textOffset[1])
            : undefined,
          disableDepthTestDistance: 0,
          position: textTranslatePlacement.position,
          scale: 1,
          show: true,
          text: renderedSymbolText,
          verticalOrigin: convertVerticalOrigin(textPlacement.textAnchor),
        });
        renderables.push({
          collection: labelCollection,
          index: labelCount,
        });
        labelCount += 1;
      }

      appendPlacementPart(bucketPlacement, collisionParts, placementGrid, {
        collision: textPlacement.collision,
        groupKey: placementGroupKey,
        kind: 'text',
        renderables,
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

    if (bucketPlacement.renderables.length > 0) {
      bucketPlacements.push(bucketPlacement);
    }
  }

  const collections: BucketSymbolCollectionHandle[] = [];

  if (billboardCount > 0) {
    collections.push({
      byteLength: billboardCount * 100,
      collection: billboardCollection,
      itemCount: billboardCount,
      layerId,
    });
  }
  else {
    billboardCollection.destroy();
  }

  if (labelCount > 0) {
    collections.push({
      byteLength: labelCount * 100,
      collection: labelCollection,
      itemCount: labelCount,
      layerId,
    });
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
  if (part.renderables.length === 0) {
    return;
  }

  collisionParts.push(part);
  bucketPlacement.renderables.push(...part.renderables);

  if (gridPlacement.collision?.blocksOtherSymbols) {
    placementGrid.insert(gridPlacement);
  }
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
