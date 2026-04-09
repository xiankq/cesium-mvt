import type { DisplayFeatureCache } from '../mesh/display-feature';
import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer } from '../types';
import type { WarningContext } from '../warning-context';
import type { SymbolCollisionIndex } from './symbol-collision';
import type { CompositeSpriteItem } from './symbol-composite';
import type {
  SymbolAnchor,
  SymbolPlacementGroup,
  TileRenderableLike,
} from './symbol-types';
import type { createTileTransform } from './tile-transform';
import { Cartesian3 } from '@cesium/engine';
import { getClippedDisplayFeature } from '../mesh/display-feature';
import { warnUnsupportedLayerProperty } from '../warning-context';
import { getLayerHeightOffset, liftLocalPosition } from './layer-height';
import { resolveSymbolAnchors } from './symbol-anchor';
import { createBillboardCollection, createLabelCollection } from './symbol-billboard-label';
import { applyPlacementVisibility, createSymbolCollisionBox, resolveZOrderMode } from './symbol-collision';
import { buildCompositeSpriteAtlas, createCompositeCacheKey, getOrCreateCompositeSpriteEntry } from './symbol-composite';
import { applyIconTextFit, estimateIconByteLength, resolveIconTextFitPadding, resolveSymbolIcon } from './symbol-icon';
import { createMultilineLabelItems, estimateLabelByteLength, resolveSymbolLabel } from './symbol-label';
import { canUpdateCesiumCollections, resolveRotationAlignment, resolveSymbolBoolean } from './symbol-utils';

export type { TileRenderableLike } from './symbol-types';

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

function warnUnsupportedSymbolLayerProperties(
  layer: CompiledStyleLayer,
  warningContext: WarningContext | undefined,
): void {
  if (layer.layout['symbol-placement'] === 'line' && layer.layout['symbol-avoid-edges']) {
    warnUnsupportedLayerProperty(warningContext, layer, 'layout', 'symbol-avoid-edges');
  }
}
