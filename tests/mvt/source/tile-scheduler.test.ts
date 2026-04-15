import { describe, expect, it } from 'vitest';
import { TileScheduler } from '@/mvt/source/tile-scheduler';

describe('tile-scheduler', () => {
  it('应该保持 tile selection 输出的请求顺序，避免在 scheduler 里再次排序', () => {
    const scheduler = new TileScheduler({
      minimumLevel: 0,
      rectangle: {} as any,
      tileWidth: 256,
      tilingScheme: {} as any,
    });

    const selection = scheduler.resolveSourceTiles(
      [
        { level: 5, x: 0, y: 0 },
        { level: 5, x: 1, y: 1 },
        { level: 5, x: 10, y: 10 },
      ],
      'base',
      () => 'missing',
      {},
    );

    expect(selection.requestCoordinates).toEqual([
      { level: 5, x: 0, y: 0 },
      { level: 5, x: 1, y: 1 },
      { level: 5, x: 10, y: 10 },
    ]);
  });
});
