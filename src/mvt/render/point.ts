import {
  Color,
  type PointPrimitive,
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
  onPoint?: (point: PointPrimitive) => void
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
      })
      onPoint?.(pointPrimitive)
      count += 1
    }
  }

  return count
}
