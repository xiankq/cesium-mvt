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
