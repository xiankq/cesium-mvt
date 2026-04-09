import { describe, expect, it } from 'vitest';
import {
  createTileKey,
  createTileRequest,
} from '../../src/mvt/source/tile-request';

describe('tile-request', () => {
  it('builds xyz tile urls from a tile template', () => {
    const request = createTileRequest({
      coordinate: {
        level: 4,
        x: 10,
        y: 6,
      },
      sourceId: 'base',
      tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
    });

    expect(request).toEqual({
      coordinate: {
        level: 4,
        x: 10,
        y: 6,
      },
      key: createTileKey('base', 4, 10, 6),
      sourceId: 'base',
      url: 'https://tiles.example.com/4/10/6.pbf',
    });
  });

  it('flips the y coordinate for tms templates', () => {
    const request = createTileRequest({
      coordinate: {
        level: 3,
        x: 2,
        y: 1,
      },
      scheme: 'tms',
      sourceId: 'base',
      tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
    });

    expect(request.url).toBe('https://tiles.example.com/3/2/6.pbf');
  });
});
