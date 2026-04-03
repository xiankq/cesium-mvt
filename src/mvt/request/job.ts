import type { TilingScheme } from 'cesium'
import { buildTileUrl } from './template'
import type { MvtSourceOptions, TileCoord, TileDecodeJob } from '../types'

export function createTileDecodeJob(
  source: MvtSourceOptions,
  tilingScheme: TilingScheme,
  coord: TileCoord,
): TileDecodeJob {
  const tileWidth = source.tileWidth ?? 256
  const tileHeight = source.tileHeight ?? tileWidth

  return {
    id: `${source.id}:${coord.level}/${coord.x}/${coord.y}`,
    sourceId: source.id,
    coord,
    url: buildTileUrl(source.urlTemplate, {
      x: coord.x,
      y: coord.y,
      level: coord.level,
      tilingScheme,
      tileWidth,
      tileHeight,
      subdomains: source.subdomains,
      maximumLevel: source.maximumLevel,
      customTags: source.customTags,
    }),
    requestedAt: Date.now(),
  }
}
