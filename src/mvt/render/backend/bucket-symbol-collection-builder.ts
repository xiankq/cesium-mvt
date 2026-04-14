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
} from './bucket-symbol-types';
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
import { createSymbolPlacementGrid } from './symbol-placement-grid';
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
  combineSymbolCollisions,
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
  const placementGrid = createSymbolPlacementGrid();

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

    if (context.feature && !filter({ zoom: context.zoom, feature: context.feature })) {
      continue;
    }

    const symbolStyle = resolveStyle(context);
    placements.push({
      position: Cartesian3.fromElements(x, y, z),
      lineAngle: data.lineAngles?.[index],
      sourceIndex: index,
      symbolStyle,
      viewportLatitude: symbolStyle.zOrder === 'viewport-y'
        ? getViewportLatitude(Cartesian3.fromElements(x, y, z))
        : undefined,
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

    const bucketPlacement: BucketSymbolPlacementHandle = {
      ...basePlacement,
      collision: combineSymbolCollisions(
        basePlacement.anchorX,
        basePlacement.anchorY,
        shouldRenderText ? textPlacement : undefined,
        shouldRenderIcon ? iconPlacement : undefined,
      ),
      lineAngle: placement.lineAngle,
      sourceIndex: placement.sourceIndex,
      sourceLayer: bucket.sourceLayer,
      textAnchor: shouldRenderText
        ? textPlacement?.textAnchor
        : iconPlacement?.iconAnchor,
      textOffset: shouldRenderText
        ? textPlacement?.textOffset
        : iconPlacement?.iconOffset,
      layerId,
      renderables: [],
    };

    let hasRenderableContent = false;

    if (shouldRenderIcon && fittedIconImage && iconPlacement) {
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
      bucketPlacement.renderables.push({
        collection: billboardCollection,
        index: billboardCount,
      });
      billboardCount += 1;
      hasRenderableContent = true;
    }

    if (shouldRenderText && textPlacement) {
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
            bucketPlacement.renderables.push({
              collection: billboardCollection,
              index: billboardCount,
            });
            billboardCount += 1;
            hasRenderableContent = true;
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
          bucketPlacement.renderables.push({
            collection: labelCollection,
            index: labelCount,
          });
          labelCount += 1;
          hasRenderableContent = true;
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
        bucketPlacement.renderables.push({
          collection: labelCollection,
          index: labelCount,
        });
        labelCount += 1;
        hasRenderableContent = true;
      }
    }

    if (hasRenderableContent) {
      bucketPlacements.push(bucketPlacement);
      if (bucketPlacement.collision?.blocksOtherSymbols) {
        placementGrid.insert(bucketPlacement);
      }
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

export function compareSymbolPlacements(
  left: SymbolPlacement,
  right: SymbolPlacement,
): number {
  if (left.symbolStyle.sortKey !== undefined || right.symbolStyle.sortKey !== undefined) {
    const leftSortKey = left.symbolStyle.sortKey ?? 0;
    const rightSortKey = right.symbolStyle.sortKey ?? 0;
    if (leftSortKey !== rightSortKey) {
      return leftSortKey - rightSortKey;
    }
  }

  const leftOrderMode = resolveSymbolOrderMode(left.symbolStyle);
  const rightOrderMode = resolveSymbolOrderMode(right.symbolStyle);
  if (leftOrderMode !== 'source' || rightOrderMode !== 'source') {
    const leftLatitude = left.viewportLatitude ?? getViewportLatitude(left.position);
    const rightLatitude = right.viewportLatitude ?? getViewportLatitude(right.position);
    if (leftLatitude !== rightLatitude) {
      return rightLatitude - leftLatitude;
    }
  }

  return left.sourceIndex - right.sourceIndex;
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

function resolveSymbolOrderMode(
  symbolStyle: SymbolLayerStyle,
): 'source' | 'viewport-y' {
  return symbolStyle.zOrder === 'source' ? 'source' : 'viewport-y';
}
