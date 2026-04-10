import type { TileCoordinate } from './source/tile-request';

export type TileAvailability = 'empty' | 'missing' | 'ready';

export interface ResolveTileSelectionOptions {
  coordinates: readonly TileCoordinate[];
  getAvailability: (coordinate: TileCoordinate) => TileAvailability;
  minimumLevel: number;
  maximumLevel?: number;
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
  maximumLevel,
}: ResolveTileSelectionOptions): TileSelection {
  const readyCoordinates: TileCoordinate[] = [];
  const emptyCoordinates: TileCoordinate[] = [];
  const requestCoordinates: TileCoordinate[] = [];
  const availabilityByKey = new Map<string, TileAvailability>();

  // 当请求的层级低于数据源最小层级时，需要生成所有对应的子瓦片
  // 例如：level=8 的一个瓦片对应 level=10 的 4 个子瓦片
  const expandedCoordinates: TileCoordinate[] = [];
  for (const coordinate of coordinates) {
    let adjustedCoordinate = coordinate;

    // 当请求的瓦片层级超过数据源的最大层级时，需要将坐标映射到最大层级
    // 例如：请求 level=18，但数据源最大只到 level=14，则映射到 level=14 的父瓦片
    if (maximumLevel !== undefined && coordinate.level > maximumLevel) {
      const levelDiff = coordinate.level - maximumLevel;
      adjustedCoordinate = {
        level: maximumLevel,
        x: Math.floor(coordinate.x / 2 ** levelDiff),
        y: Math.floor(coordinate.y / 2 ** levelDiff),
      };
    }

    // 当请求的瓦片层级低于数据源的最小层级时，需要生成所有对应的子瓦片
    // 例如：请求 level=8，但数据源最小从 level=10 开始，则生成 level=10 的所有子瓦片
    if (adjustedCoordinate.level < minimumLevel) {
      const levelDiff = minimumLevel - adjustedCoordinate.level;
      const baseX = adjustedCoordinate.x * 2 ** levelDiff;
      const baseY = adjustedCoordinate.y * 2 ** levelDiff;
      const count = 2 ** levelDiff;

      for (let dx = 0; dx < count; dx++) {
        for (let dy = 0; dy < count; dy++) {
          expandedCoordinates.push({
            level: minimumLevel,
            x: baseX + dx,
            y: baseY + dy,
          });
        }
      }
    }
    else {
      expandedCoordinates.push(adjustedCoordinate);
    }
  }

  for (const adjustedCoordinate of expandedCoordinates) {
    const availability = getAvailability(adjustedCoordinate);
    availabilityByKey.set(createCoordinateKey(adjustedCoordinate), availability);

    if (availability === 'ready') {
      readyCoordinates.push(adjustedCoordinate);
      continue;
    }

    if (availability === 'empty') {
      emptyCoordinates.push(adjustedCoordinate);
      continue;
    }

    requestCoordinates.push(adjustedCoordinate);
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

    // 只有当当前可见范围内、属于这个祖先的子瓦片都已经 resolved 时，
    // 才能安全移除祖先 fallback；否则会在未就绪的子区域留下白洞。
    if (isFullyCoveredByResolvedVisibleDescendants(
      expandedCoordinates,
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
  let highestEmptyAncestor: TileCoordinate | undefined;

  while (ancestor && ancestor.level >= minimumLevel) {
    const availability = getAvailability(ancestor);
    if (availability === 'ready') {
      return ancestor;
    }

    if (availability === 'empty') {
      highestEmptyAncestor = ancestor;
    }

    ancestor = getParentCoordinate(ancestor);
  }

  return highestEmptyAncestor;
}

function isFullyCoveredByResolvedVisibleDescendants(
  coordinates: readonly TileCoordinate[],
  availabilityByKey: ReadonlyMap<string, TileAvailability>,
  ancestor: TileCoordinate,
): boolean {
  const descendantCoordinates = coordinates.filter((coordinate) => {
    return isDescendantCoordinate(coordinate, ancestor);
  });

  if (descendantCoordinates.length === 0) {
    return false;
  }

  return descendantCoordinates.every((coordinate) => {
    const availability = availabilityByKey.get(createCoordinateKey(coordinate));
    return availability !== 'missing';
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
