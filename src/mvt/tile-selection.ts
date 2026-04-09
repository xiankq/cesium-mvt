import type { TileCoordinate } from './source/tile-request';

export type TileAvailability = 'empty' | 'missing' | 'ready';

export interface ResolveTileSelectionOptions {
  coordinates: readonly TileCoordinate[];
  getAvailability: (coordinate: TileCoordinate) => TileAvailability;
  minimumLevel: number;
}

export interface TileSelection {
  emptyCoordinates: TileCoordinate[];
  fallbackCoordinates: TileCoordinate[];
  readyCoordinates: TileCoordinate[];
  requestCoordinates: TileCoordinate[];
}

export function resolveTileSelection({
  coordinates,
  getAvailability,
  minimumLevel,
}: ResolveTileSelectionOptions): TileSelection {
  const readyCoordinates: TileCoordinate[] = [];
  const emptyCoordinates: TileCoordinate[] = [];
  const requestCoordinates: TileCoordinate[] = [];
  const availabilityByKey = new Map<string, TileAvailability>();

  for (const coordinate of coordinates) {
    const availability = getAvailability(coordinate);
    availabilityByKey.set(createCoordinateKey(coordinate), availability);

    if (availability === 'ready') {
      readyCoordinates.push(coordinate);
      continue;
    }

    if (availability === 'empty') {
      emptyCoordinates.push(coordinate);
      continue;
    }

    requestCoordinates.push(coordinate);
  }

  const fallbackCoordinatesByKey = new Map<string, TileCoordinate>();
  for (const coordinate of requestCoordinates) {
    const fallbackCoordinate = findFallbackCoordinate({
      coordinate,
      getAvailability,
      minimumLevel,
    });
    if (!fallbackCoordinate) {
      continue;
    }

    // 当前没有做 tile 区域裁剪，某个祖先一旦与已解析的可见子级同时显示，
    // 就会在子级覆盖范围里发生重复绘制，因此这里先抑制这种 fallback。
    if (hasResolvedVisibleDescendant(
      coordinates,
      availabilityByKey,
      fallbackCoordinate,
    )) {
      continue;
    }

    fallbackCoordinatesByKey.set(
      createCoordinateKey(fallbackCoordinate),
      fallbackCoordinate,
    );
  }

  return {
    emptyCoordinates,
    fallbackCoordinates: [...fallbackCoordinatesByKey.values()],
    readyCoordinates,
    requestCoordinates,
  };
}

function findFallbackCoordinate({
  coordinate,
  getAvailability,
  minimumLevel,
}: {
  coordinate: TileCoordinate;
  getAvailability: (coordinate: TileCoordinate) => TileAvailability;
  minimumLevel: number;
}): TileCoordinate | undefined {
  let ancestor = getParentCoordinate(coordinate);
  while (ancestor && ancestor.level >= minimumLevel) {
    const availability = getAvailability(ancestor);
    if (availability === 'ready') {
      return ancestor;
    }

    ancestor = getParentCoordinate(ancestor);
  }

  return undefined;
}

function hasResolvedVisibleDescendant(
  coordinates: readonly TileCoordinate[],
  availabilityByKey: ReadonlyMap<string, TileAvailability>,
  ancestor: TileCoordinate,
): boolean {
  return coordinates.some((coordinate) => {
    if (!isDescendantCoordinate(coordinate, ancestor)) {
      return false;
    }

    return availabilityByKey.get(createCoordinateKey(coordinate)) !== 'missing';
  });
}

function isDescendantCoordinate(
  coordinate: TileCoordinate,
  ancestor: TileCoordinate,
): boolean {
  if (coordinate.level <= ancestor.level) {
    return false;
  }

  const levelDelta = coordinate.level - ancestor.level;
  return Math.floor(coordinate.x / 2 ** levelDelta) === ancestor.x
    && Math.floor(coordinate.y / 2 ** levelDelta) === ancestor.y;
}

function getParentCoordinate(coordinate: TileCoordinate): TileCoordinate | undefined {
  if (coordinate.level === 0) {
    return undefined;
  }

  return {
    level: coordinate.level - 1,
    x: Math.floor(coordinate.x / 2),
    y: Math.floor(coordinate.y / 2),
  };
}

function createCoordinateKey(coordinate: TileCoordinate): string {
  return `${coordinate.level}/${coordinate.x}/${coordinate.y}`;
}
