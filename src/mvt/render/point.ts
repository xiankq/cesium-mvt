import {
  Color,
  PointPrimitiveCollection,
  type TilingScheme,
} from 'cesium'
import type {
  DecodedFeatureRecord,
  DecodedTileRecord,
} from '../types'
import { tilePointToCartesian } from './geometry'

export type RenderPointPrimitivesOptions = {
  tilingScheme: TilingScheme
  tile: DecodedTileRecord
  extent: number
  layerId: string
  feature: DecodedFeatureRecord
  collection: PointPrimitiveCollection | undefined
  color: Color
  outlineColor: Color
  pixelSize: number
  outlineWidth?: number
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
  } = options

  if (!collection) {
    return 0
  }

  let count = 0
  for (const part of feature.geometry) {
    for (const point of part) {
      const position = tilePointToCartesian(
        tilingScheme,
        tile.coord,
        point,
        extent,
      )

      collection.add({
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
      })
      count += 1
    }
  }

  return count
}
