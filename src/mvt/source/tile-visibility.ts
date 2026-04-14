import type { TileCoordinate } from './tile-request';

export interface SourceConstraints {
  maxZoom?: number;
  minZoom?: number;
}

export interface ShouldRequestTileOptions {
  coordinate: TileCoordinate;
  isCached: boolean;
  isPending: boolean;
  sourceConstraints: SourceConstraints;
}

export interface ShouldRenderTileOptions {
  coordinate: TileCoordinate;
  hasData: boolean;
  sourceConstraints: SourceConstraints;
}

export function isTileVisibleAtZoom(
  zoom: number,
  constraints: SourceConstraints,
): boolean {
  const { maxZoom, minZoom } = constraints;
  const effectiveMinZoom = minZoom ?? Number.NEGATIVE_INFINITY;
  const effectiveMaxZoom = maxZoom ?? Number.POSITIVE_INFINITY;

  return zoom >= effectiveMinZoom && zoom < effectiveMaxZoom;
}

export function shouldRequestTile(options: ShouldRequestTileOptions): boolean {
  const { coordinate, isCached, isPending, sourceConstraints } = options;

  if (isCached || isPending) {
    return false;
  }

  return isTileVisibleAtZoom(coordinate.level, sourceConstraints);
}

export function shouldRenderTile(options: ShouldRenderTileOptions): boolean {
  const { coordinate, hasData, sourceConstraints } = options;

  if (!hasData) {
    return false;
  }

  const { minZoom } = sourceConstraints;
  if (minZoom !== undefined && coordinate.level < minZoom) {
    return false;
  }

  return true;
}
