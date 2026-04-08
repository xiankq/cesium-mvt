import { describe, expect, it } from 'vitest';
import {
  createMvtOverzoomTransform,
  getMvtSourceTileCoordinate,
  mapSourceTilePointToDisplayTilePoint,
} from '../src/mvt/tile/mvt-overzoom';

describe('mvt-overzoom', () => {
  it('maps display tiles to clamped source tiles at source maxzoom', () => {
    expect(getMvtSourceTileCoordinate({ x: 34567, y: 23123, z: 16 }, 14)).toEqual({
      x: Math.floor(34567 / 4),
      y: Math.floor(23123 / 4),
      z: 14,
    });
    expect(getMvtSourceTileCoordinate({ x: 12, y: 34, z: 8 }, 14)).toEqual({
      x: 12,
      y: 34,
      z: 8,
    });
  });

  it('projects source tile coordinates into overscaled display tile coordinates', () => {
    const sourceCoordinate = { x: 3, y: 5, z: 4 };
    const displayCoordinate = { x: 13, y: 21, z: 6 };
    const transform = createMvtOverzoomTransform(displayCoordinate, sourceCoordinate);

    expect(transform.coordinateScale).toBe(4);
    expect(transform.tileOffsetX).toBe(1);
    expect(transform.tileOffsetY).toBe(1);

    expect(
      mapSourceTilePointToDisplayTilePoint({ x: 256, y: 256 }, 4096, transform),
    ).toEqual({
      x: 256 * 4 - 4096,
      y: 256 * 4 - 4096,
    });
  });
});
