import type { VectorTileLayer } from '@mapbox/vector-tile';
import type { TileRequest } from './tile-request';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

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
