import type { TileCoordinate } from '../types';

const tileKeyPattern = /^(\d+)\/(\d+)\/(\d+)$/;

export function createTileKey(coordinate: TileCoordinate): string {
  return `${coordinate.z}/${coordinate.x}/${coordinate.y}`;
}

export function parseTileKey(tileKey: string): TileCoordinate {
  const match = tileKeyPattern.exec(tileKey);
  if (!match) {
    throw new Error(`Invalid tile key: ${tileKey}`);
  }

  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
  };
}

export function isSameTileCoordinate(
  left: TileCoordinate,
  right: TileCoordinate,
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}
