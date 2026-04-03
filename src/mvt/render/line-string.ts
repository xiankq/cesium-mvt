import {
  Color,
  PolylineCollection,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedTileRecord,
} from '../types'
import {
  createPolylineMaterial,
  ensureClosedLoop,
  toCartesianPositions,
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
  } = options

  if (!collection) {
    return 0
  }

  let count = 0
  for (const part of feature.geometry) {
    if (part.length < 2) {
      continue
    }

    const positions = toCartesianPositions(
      tilingScheme,
      tile.coord,
      part,
      extent,
    )
    if (positions.length < 2) {
      continue
    }

    collection.add({
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
    count += 1
  }

  return count
}
