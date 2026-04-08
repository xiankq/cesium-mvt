import type { MvtTileCoordinate } from '../mvt-types';

const tileKeyPattern = /^(\d+)\/(\d+)\/(\d+)$/;

export function createMvtTileKey(coordinate: MvtTileCoordinate): string {
  return `${coordinate.z}/${coordinate.x}/${coordinate.y}`;
}

export function parseMvtTileKey(tileKey: string): MvtTileCoordinate {
  const match = tileKeyPattern.exec(tileKey);
  if (!match) {
    throw new Error(`Invalid MVT tile key: ${tileKey}`);
  }

  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
  };
}

export function isSameMvtTileCoordinate(
  left: MvtTileCoordinate,
  right: MvtTileCoordinate,
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}
