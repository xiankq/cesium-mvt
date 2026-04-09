import type { CompositeSpriteAtlas } from './symbol-composite';
import type { SymbolIconItem, SymbolPlacementGroup } from './symbol-types';
import type { createTileTransform } from './tile-transform';
import { BillboardCollection, BoundingRectangle, LabelCollection } from '@cesium/engine';

export function createBillboardCollection(
  placementGroups: readonly SymbolPlacementGroup[],
  transform: ReturnType<typeof createTileTransform>,
  compositeAtlas?: CompositeSpriteAtlas,
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

export function createLabelCollection(
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
