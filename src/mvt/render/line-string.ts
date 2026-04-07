import {
  Color,
  type Polyline,
  PolylineCollection,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedTileRecord,
} from '../types'
import {
  createTileTransformContext,
  createPolylineMaterial,
  ensureClosedLoop,
  type TileTransformContext,
  toCartesianPositionsWithContext,
} from './geometry'

export type RenderLineStringPrimitivesOptions = {
  tilingScheme: TilingScheme
  tile: DecodedTileRecord
  extent: number
  layerId: string
  feature: DecodedFeatureRecord
  collection: PolylineCollection | undefined
  color: Color
  width: number
  closedLoop?: boolean
  onPolyline?: (polyline: Polyline) => void
  transformContext?: TileTransformContext
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
  } = options

  if (!collection) {
    return 0
  }

  const resolvedTransformContext =
    transformContext
    ?? createTileTransformContext(
      tilingScheme,
      tile.coord,
      extent,
    )
  let count = 0
  for (const part of feature.geometry) {
    if (part.length < 2) {
      continue
    }

    const positions = toCartesianPositionsWithContext(
      resolvedTransformContext,
      part,
    )
    if (positions.length < 2) {
      continue
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
    })
    onPolyline?.(polyline)
    count += 1
  }

  return count
}
