import { describe, expect, it } from 'vitest';
import { createTileKey, parseTileKey } from '../src/mvt/tile/tile-key';

describe('tile-key', () => {
  it('creates and parses tile keys', () => {
    const key = createTileKey({ x: 13524, y: 6212, z: 14 });

    expect(key).toBe('14/13524/6212');
    expect(parseTileKey(key)).toEqual({
      x: 13524,
      y: 6212,
      z: 14,
    });
  });
});
