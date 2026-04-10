import { describe, expect, it } from 'vitest';
import { resolveTileSelection } from '@/mvt/source/tile-selection';

describe('tile-selection', () => {
  it('uses the nearest ready ancestor as fallback for missing visible child tiles', () => {
    const selection = resolveTileSelection({
      coordinates: [
        { level: 2, x: 0, y: 0 },
        { level: 2, x: 1, y: 0 },
      ],
      getAvailability: (coordinate) => {
        if (coordinate.level === 1 && coordinate.x === 0 && coordinate.y === 0) {
          return 'ready';
        }

        return 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection.readyCoordinates).toEqual([]);
    expect(selection.emptyCoordinates).toEqual([]);
    expect(selection.requestCoordinates).toEqual([
      { level: 2, x: 0, y: 0 },
      { level: 2, x: 1, y: 0 },
    ]);
    expect(selection.fallbackCoordinates).toEqual([
      { level: 1, x: 0, y: 0 },
    ]);
  });

  it('suppresses ancestor fallback when the visible descendants already contain resolved tiles', () => {
    const selection = resolveTileSelection({
      coordinates: [
        { level: 2, x: 0, y: 0 },
        { level: 2, x: 1, y: 0 },
      ],
      getAvailability: (coordinate) => {
        if (coordinate.level === 2 && coordinate.x === 0 && coordinate.y === 0) {
          return 'empty';
        }

        if (coordinate.level === 2 && coordinate.x === 1 && coordinate.y === 0) {
          return 'ready';
        }

        if (coordinate.level === 1 && coordinate.x === 0 && coordinate.y === 0) {
          return 'ready';
        }

        return 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection.readyCoordinates).toEqual([
      { level: 2, x: 1, y: 0 },
    ]);
    expect(selection.emptyCoordinates).toEqual([
      { level: 2, x: 0, y: 0 },
    ]);
    expect(selection.requestCoordinates).toEqual([]);
    expect(selection.fallbackCoordinates).toEqual([]);
  });

  it('keeps ancestor fallback while part of the visible descendant coverage is still missing', () => {
    const selection = resolveTileSelection({
      coordinates: [
        { level: 2, x: 0, y: 0 },
        { level: 2, x: 1, y: 0 },
        { level: 2, x: 0, y: 1 },
        { level: 2, x: 1, y: 1 },
      ],
      getAvailability: (coordinate) => {
        if (coordinate.level === 2 && coordinate.x === 0 && coordinate.y === 0) {
          return 'ready';
        }

        if (coordinate.level === 2 && coordinate.x === 1 && coordinate.y === 0) {
          return 'empty';
        }

        if (coordinate.level === 1 && coordinate.x === 0 && coordinate.y === 0) {
          return 'ready';
        }

        return 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection.readyCoordinates).toEqual([
      { level: 2, x: 0, y: 0 },
    ]);
    expect(selection.emptyCoordinates).toEqual([
      { level: 2, x: 1, y: 0 },
    ]);
    expect(selection.requestCoordinates).toEqual([
      { level: 2, x: 0, y: 1 },
      { level: 2, x: 1, y: 1 },
    ]);
    expect(selection.fallbackCoordinates).toEqual([
      { level: 1, x: 0, y: 0 },
    ]);
  });
});
