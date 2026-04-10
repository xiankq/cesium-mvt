import { describe, expect, it } from 'vitest';
import { resolveTileSelection } from '../../src/mvt/tile-selection';

describe('tile-selection fallback issue', () => {
  it('should find fallback ancestor when intermediate tiles are empty', () => {
    const coordinates = [
      { level: 14, x: 10000, y: 10000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'missing'],
      ['13/5000/5000', 'empty'],
      ['12/2500/2500', 'ready'],
      ['11/1250/1250', 'ready'],
    ]);

    const selection = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap.get(key) ?? 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection.requestCoordinates).toHaveLength(1);
    expect(selection.requestCoordinates[0]).toEqual({ level: 14, x: 10000, y: 10000 });

    expect(selection.fallbackCoordinates).toHaveLength(1);
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });
  });

  it('should stop searching for fallback when all ancestors are empty', () => {
    const coordinates = [
      { level: 14, x: 10000, y: 10000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'missing'],
      ['13/5000/5000', 'empty'],
      ['12/2500/2500', 'empty'],
      ['11/1250/1250', 'empty'],
    ]);

    const selection = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap.get(key) ?? 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection.requestCoordinates).toHaveLength(1);
    expect(selection.fallbackCoordinates).toHaveLength(1);
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 11, x: 1250, y: 1250 });
  });
});
