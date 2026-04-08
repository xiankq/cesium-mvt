import type { Color, PointPrimitive, PointPrimitiveCollection, TilingScheme } from 'cesium';
import type { DecodedFeatureRecord, DecodedTileRecord } from '../types';
import type { TileTransformContext } from './geometry';
import { createTileTransformContext, tilePointToCartesianWithContext } from './geometry';

export interface RenderPointPrimitivesOptions {
  tilingScheme: TilingScheme;
  tile: DecodedTileRecord;
  extent: number;
  layerId: string;
  feature: DecodedFeatureRecord;
  collection: PointPrimitiveCollection | undefined;
  color: Color;
  outlineColor: Color;
  pixelSize: number;
  outlineWidth?: number;
  onPoint?: (point: PointPrimitive) => void;
  transformContext?: TileTransformContext;
}

export function renderPointPrimitives(
  options: RenderPointPrimitivesOptions,
): number {
  const {
    tilingScheme,
    tile,
    extent,
    layerId,
    feature,
    collection,
    color,
    outlineColor,
    pixelSize,
    outlineWidth,
    onPoint,
    transformContext,
  } = options;

  if (!collection) {
    return 0;
  }

  const resolvedTransformContext
    = transformContext
      ?? createTileTransformContext(
        tilingScheme,
        tile.coord,
        extent,
      );
  let count = 0;
  for (const part of feature.geometry) {
    for (const point of part) {
      const position = tilePointToCartesianWithContext(
        resolvedTransformContext,
        point,
      );

      const pointPrimitive = collection.add({
        show: true,
        position,
        color,
        outlineColor,
        outlineWidth: outlineWidth ?? 1,
        pixelSize,
        id: {
          tileId: tile.id,
          layer: layerId,
          featureId: feature.id,
        },
      });
      onPoint?.(pointPrimitive);
      count += 1;
    }
  }

  return count;
}
