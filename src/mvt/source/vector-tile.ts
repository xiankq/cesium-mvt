import type { VectorTileLayer } from '@mapbox/vector-tile';
import type { TileRequest } from './tile-request';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

// ParsedTile 封装了原始 MVT 解码结果，远程 vector source 和
// GeoJSON 转出来的合成瓦片都会复用这一套访问方式。
export type ParsedTile = VectorTile;

export function parseVectorTile(data: ArrayBuffer) {
  return new VectorTile(new Pbf(new Uint8Array(data)));
}

export function listSourceLayers(tile: ParsedTile) {
  return Object.keys(tile.layers);
}

export function getSourceLayer(
  tile: ParsedTile,
  sourceLayer: string,
): VectorTileLayer | undefined {
  return tile.layers[sourceLayer];
}

export async function loadVectorTile(
  request: TileRequest,
  signal: AbortSignal,
) {
  const response = await fetch(request.url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load tile: ${request.url}`);
  }

  return parseVectorTile(await response.arrayBuffer());
}
