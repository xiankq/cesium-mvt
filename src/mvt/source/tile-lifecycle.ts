import type { TileCoordinate } from './tile-request';
import type { SourceConstraints } from './tile-visibility';

export interface TileLifecycleOptions {
  coordinate: TileCoordinate;
  isCached: boolean;
  isPending: boolean;
  isVisible: boolean;
  sourceConstraints: SourceConstraints;
}

export type TileLifecycleAction = 'hide' | 'request' | 'show' | 'skip' | 'wait';

export function computeTileLifecycle(
  options: TileLifecycleOptions,
): TileLifecycleAction {
  const {
    coordinate,
    isCached,
    isPending,
    isVisible,
    sourceConstraints,
  } = options;

  const { maxZoom, minZoom } = sourceConstraints;

  if (minZoom !== undefined && coordinate.level < minZoom) {
    return 'skip';
  }

  if (maxZoom !== undefined && coordinate.level > maxZoom) {
    return 'skip';
  }

  if (!isVisible) {
    if (isCached) {
      return 'hide';
    }
    return 'skip';
  }

  if (isCached) {
    return 'show';
  }

  if (isPending) {
    return 'wait';
  }

  return 'request';
}
