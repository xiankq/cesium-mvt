import { describe, expect, it } from 'vitest';
import { TileManager } from '../../src/mvt/source/tile-manager';

describe('tile-manager hidden state', () => {
  it('should not unload hidden tiles immediately', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    const frameResult = tileManager.endFrame();

    expect(frameResult.hiddenKeys).toEqual(['base/12/2500/2500']);
    expect(frameResult.unloadableKeys).toEqual([]);

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      eligibleForUnloading: false,
      state: 'hidden',
    });

    tileManager.beginFrame(3);
    const finalFrameResult = tileManager.endFrame();

    expect(finalFrameResult.hiddenKeys).toEqual([]);
    expect(finalFrameResult.unloadableKeys).toEqual(['base/12/2500/2500']);

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      eligibleForUnloading: true,
      state: 'hidden',
    });
  });

  it('should keep hidden tiles if they are touched', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    const frameResult = tileManager.endFrame();

    expect(frameResult.hiddenKeys).toEqual(['base/12/2500/2500']);

    tileManager.beginFrame(3);
    tileManager.touch('base/12/2500/2500');
    const finalFrameResult = tileManager.endFrame();

    expect(finalFrameResult.hiddenKeys).toEqual([]);
    expect(finalFrameResult.unloadableKeys).toEqual([]);

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      eligibleForUnloading: false,
      state: 'hidden',
    });
  });
});
