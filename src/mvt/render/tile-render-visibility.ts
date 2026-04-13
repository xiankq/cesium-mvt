import type { SourceConstraints } from '../source/tile-visibility';

export interface TileRenderVisibilityOptions {
  currentZoom: number;
  hasData: boolean;
  sourceConstraints: SourceConstraints;
}

export function compileTileRenderVisibility(
  options: TileRenderVisibilityOptions,
): 'hidden' | 'visible' {
  const { currentZoom, hasData, sourceConstraints } = options;

  if (!hasData) {
    return 'hidden';
  }

  const { minZoom } = sourceConstraints;
  if (minZoom !== undefined && currentZoom < minZoom) {
    return 'hidden';
  }

  return 'visible';
}

export function isTileRenderable(
  currentZoom: number,
  sourceConstraints: SourceConstraints,
): boolean {
  const { minZoom } = sourceConstraints;
  if (minZoom !== undefined && currentZoom < minZoom) {
    return false;
  }
  return true;
}
