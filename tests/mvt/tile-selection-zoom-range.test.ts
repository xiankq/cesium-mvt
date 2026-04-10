import { describe, expect, it } from 'vitest';
import { resolveTileSelection } from '@/mvt/tile-selection';

describe('tile-selection minzoom/maxzoom', () => {
  it('should use maxzoom tiles when zoom exceeds maxzoom', () => {
    const coordinates = [
      { level: 18, x: 100000, y: 100000 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['14/6250/6250', 'ready'],
    ]);

    const selection = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap.get(key) ?? 'missing';
      },
      minimumLevel: 0,
      maximumLevel: 14,
    });

    expect(selection.requestCoordinates).toHaveLength(0);
    expect(selection.fallbackCoordinates).toHaveLength(0);
    expect(selection.readyCoordinates).toHaveLength(1);
    expect(selection.readyCoordinates[0]).toEqual({ level: 14, x: 6250, y: 6250 });
  });

  it('should not request tiles below minzoom', () => {
    const coordinates = [
      { level: 8, x: 100, y: 100 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['10/400/400', 'ready'],
    ]);

    const selection = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap.get(key) ?? 'missing';
      },
      minimumLevel: 10,
      maximumLevel: 16,
    });

    expect(selection.requestCoordinates).toHaveLength(0);
    expect(selection.fallbackCoordinates).toHaveLength(0);
    expect(selection.readyCoordinates).toHaveLength(1);
    expect(selection.readyCoordinates[0]).toEqual({ level: 10, x: 400, y: 400 });
  });

  it('should handle tiles within minzoom/maxzoom range', () => {
    const coordinates = [
      { level: 12, x: 2500, y: 2500 },
    ];

    const availabilityMap = new Map<string, 'empty' | 'missing' | 'ready'>([
      ['12/2500/2500', 'ready'],
    ]);

    const selection = resolveTileSelection({
      coordinates,
      getAvailability: (coord) => {
        const key = `${coord.level}/${coord.x}/${coord.y}`;
        return availabilityMap.get(key) ?? 'missing';
      },
      minimumLevel: 10,
      maximumLevel: 16,
    });

    expect(selection.requestCoordinates).toHaveLength(0);
    expect(selection.fallbackCoordinates).toHaveLength(0);
    expect(selection.readyCoordinates).toHaveLength(1);
    expect(selection.readyCoordinates[0]).toEqual({ level: 12, x: 2500, y: 2500 });
  });
});
