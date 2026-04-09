import { describe, expect, it } from 'vitest';
import { createMvtTileKey, isSameMvtTileCoordinate, parseMvtTileKey } from '../src/mvt/tile/mvt-tile-key';

describe('mvt-tile-key', () => {
  it('creates and parses tile keys', () => {
    const key = createMvtTileKey({ x: 13524, y: 6212, z: 14 });

    expect(key).toBe('14/13524/6212');
    expect(parseMvtTileKey(key)).toEqual({
      x: 13524,
      y: 6212,
      z: 14,
    });
  });

  it('compares tile coordinates', () => {
    expect(isSameMvtTileCoordinate(
      { x: 1, y: 2, z: 3 },
      { x: 1, y: 2, z: 3 },
    )).toBe(true);
    expect(isSameMvtTileCoordinate(
      { x: 1, y: 2, z: 3 },
      { x: 1, y: 2, z: 4 },
    )).toBe(false);
  });
});
