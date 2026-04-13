import { getTileBBox } from '@mapbox/whoots-js';

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
): string {
  return `${sourceId}/${level}/${x}/${y}`;
}

export function createTileRequest(
  options: CreateTileRequestOptions,
): TileRequest {
  const template = selectTileTemplate(options.tiles, options.coordinate);
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
  const ratio = resolvePixelRatio();

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
      .replaceAll('{prefix}', getTilePrefix(coordinate.x, coordinate.y))
      .replaceAll('{z}', `${coordinate.level}`)
      .replaceAll('{x}', `${coordinate.x}`)
      .replaceAll('{y}', `${y}`)
      .replaceAll('{ratio}', ratio > 1 ? '@2x' : '')
      .replaceAll('{quadkey}', getQuadkey(coordinate.level, coordinate.x, coordinate.y))
      .replaceAll('{bbox-epsg-3857}', getTileBBox(
        coordinate.x,
        coordinate.y,
        coordinate.level,
      )),
  };
}

function getTmsY(level: number, y: number): number {
  return 2 ** level - 1 - y;
}

function selectTileTemplate(
  tiles: string[],
  coordinate: TileCoordinate,
): string | undefined {
  if (tiles.length === 0) {
    return undefined;
  }

  // MapLibre 会按 x+y 在多个模板之间做简单轮询，避免所有请求都打到同一台主机。
  return tiles[(coordinate.x + coordinate.y) % tiles.length];
}

function resolvePixelRatio(): number {
  const devicePixelRatio = globalThis.devicePixelRatio;
  if (typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio)) {
    return devicePixelRatio;
  }

  return 1;
}

function getTilePrefix(x: number, y: number): string {
  return `${(x % 16).toString(16)}${(y % 16).toString(16)}`;
}

function getQuadkey(level: number, x: number, y: number): string {
  let quadkey = '';
  for (let i = level; i > 0; i -= 1) {
    const mask = 1 << (i - 1);
    quadkey += `${(x & mask ? 1 : 0) + (y & mask ? 2 : 0)}`;
  }
  return quadkey;
}
