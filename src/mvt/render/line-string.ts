import type {  Color,
  Polyline,
  PolylineCollection,
  TilingScheme,
} from 'cesium';
import type {  DecodedFeatureRecord,
  DecodedTileRecord,
} from '../types';
import type { TileTransformContext } from './geometry';
import { createPolylineMaterial, createTileTransformContext, ensureClosedLoop, toCartesianPositionsWithContext } from './geometry';

export interface RenderLineStringPrimitivesOptions {
  tilingScheme: TilingScheme;
  tile: DecodedTileRecord;
  extent: number;
  layerId: string;
  feature: DecodedFeatureRecord;
  collection: PolylineCollection | undefined;
  color: Color;
  width: number;
  closedLoop?: boolean;
  onPolyline?: (polyline: Polyline) => void;
  transformContext?: TileTransformContext;
}

export function renderLineStringPrimitives(
  options: RenderLineStringPrimitivesOptions,
): number {
  const {
    tilingScheme,
    tile,
    extent,
    layerId,
    feature,
    collection,
    color,
    width,
    closedLoop = false,
    onPolyline,
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
    if (part.length < 2) {
      continue;
    }

    const positions = toCartesianPositionsWithContext(
      resolvedTransformContext,
      part,
    );
    if (positions.length < 2) {
      continue;
    }

    const polyline = collection.add({
      show: true,
      positions: closedLoop ? ensureClosedLoop(positions) : positions,
      width,
      material: createPolylineMaterial(color),
      loop: false,
      id: {
        tileId: tile.id,
        layer: layerId,
        featureId: feature.id,
      },
    });
    onPolyline?.(polyline);
    count += 1;
  }

  return count;
}
