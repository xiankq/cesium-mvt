import { describe, expect, it } from 'vitest';
import { resolveTileSelection } from '../../src/mvt/tile-selection';

describe('tile-selection empty tile handling', () => {
  it('should not use empty tiles as fallback', () => {
    const coordinates = [
      { level: 14, x: 10000, y: 10000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'missing'],
      ['13/5000/5000', 'empty'],
      ['12/2500/2500', 'empty'],
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
    expect(selection.fallbackCoordinates).toHaveLength(1);
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 11, x: 1250, y: 1250 });
  });

  it('should continuously select fallback tiles while new tiles are missing', () => {
    const coordinates = [
      { level: 14, x: 10000, y: 10000 },
    ];

    const availabilityMap1 = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'missing'],
      ['12/2500/2500', 'ready'],
    ]);

    const selection1 = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap1.get(key) ?? 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection1.fallbackCoordinates).toHaveLength(1);
    expect(selection1.fallbackCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });

    const availabilityMap2 = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'missing'],
      ['12/2500/2500', 'ready'],
    ]);

    const selection2 = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap2.get(key) ?? 'missing';
      },
      minimumLevel: 0,
    });

    expect(selection2.fallbackCoordinates).toHaveLength(1);
    expect(selection2.fallbackCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });
  });
});
