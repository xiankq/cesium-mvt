import { describe, expect, it } from 'vitest';
import { resolveTileSelection } from '@/mvt/source/tile-selection';

describe('tile-selection continuous fallback', () => {
  it('should keep fallback tiles in fallbackCoordinates while new tiles are missing', () => {
    const coordinates = [
      { level: 14, x: 10000, y: 10000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'missing'],
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
    expect(selection.fallbackCoordinates).toHaveLength(1);
    expect(selection.fallbackCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });
  });

  it('should remove fallback tiles from fallbackCoordinates when new tiles are ready', () => {
    const coordinates = [
      { level: 14, x: 10000, y: 10000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/10000/10000', 'ready'],
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

    expect(selection.requestCoordinates).toHaveLength(0);
    expect(selection.fallbackCoordinates).toHaveLength(0);
    expect(selection.readyCoordinates).toHaveLength(1);
    expect(selection.readyCoordinates[0]).toEqual({ level: 14, x: 10000, y: 10000 });
  });
});
