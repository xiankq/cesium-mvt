export interface TileCoordinate {
  level: number;
  x: number;
  y: number;
}

export interface TileRequest {
  coordinate: TileCoordinate;
  key: string;
  sourceId: string;
  url: string;
}

interface CreateTileRequestOptions {
  coordinate: TileCoordinate;
  scheme?: 'tms' | 'xyz';
  sourceId: string;
  tiles: string[];
}

// tile key 带上 source 作用域，避免多个 source 共享同一组 z/x/y 时发生冲突。
export function createTileKey(
  sourceId: string,
  level: number,
  x: number,
  y: number,
) {
  return `${sourceId}/${level}/${x}/${y}`;
}

export function createTileRequest(
  options: CreateTileRequestOptions,
): TileRequest {
  const template = options.tiles[0];
  if (!template) {
    throw new Error(`Missing tile template for source: ${options.sourceId}`);
  }

  const {
    coordinate,
    sourceId,
  } = options;
  // TMS 的 y 行号从底部开始计数，和 XYZ 模板不同。
  const y = options.scheme === 'tms'
    ? getTmsY(coordinate.level, coordinate.y)
    : coordinate.y;

  return {
    coordinate,
    key: createTileKey(
      sourceId,
      coordinate.level,
      coordinate.x,
      coordinate.y,
    ),
    sourceId,
    url: template
      .replaceAll('{z}', `${coordinate.level}`)
      .replaceAll('{x}', `${coordinate.x}`)
      .replaceAll('{y}', `${y}`),
  };
}

function getTmsY(level: number, y: number) {
  return 2 ** level - 1 - y;
}
