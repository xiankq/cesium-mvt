import { describe, expect, it } from 'vitest';
import { resolveTileSelection } from '@/mvt/tile-selection';

describe('tile-selection fallback with all empty tiles', () => {
  it('should find ready ancestor when all intermediate tiles are empty', () => {
    const coordinates = [
      { level: 16, x: 40000, y: 40000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['16/40000/40000', 'missing'],
      ['15/20000/20000', 'empty'],
      ['14/10000/10000', 'empty'],
      ['13/5000/5000', 'empty'],
      ['12/2500/2500', 'ready'],
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
    expect(selection.requestCoordinates[0]).toEqual({ level: 16, x: 40000, y: 40000 });
    expect(selection.fallbackCoordinates).toHaveLength(1);
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });
  });

  it('should handle case when all tiles are empty', () => {
    const coordinates = [
      { level: 16, x: 40000, y: 40000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['16/40000/40000', 'missing'],
      ['15/20000/20000', 'empty'],
      ['14/10000/10000', 'empty'],
      ['13/5000/5000', 'empty'],
      ['12/2500/2500', 'empty'],
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
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });
  });

  it('should use empty tile as fallback when no ready tiles exist', () => {
    const coordinates = [
      { level: 16, x: 40000, y: 40000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['16/40000/40000', 'missing'],
      ['15/20000/20000', 'empty'],
      ['14/10000/10000', 'empty'],
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
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 14, x: 10000, y: 10000 });
  });
});
