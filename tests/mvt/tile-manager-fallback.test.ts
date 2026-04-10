import { describe, expect, it } from 'vitest';
import { TileManager } from '@/mvt/source/tile-manager';

describe('tile-manager fallback issue', () => {
  it('should keep fallback tiles alive while new tiles are loading', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    tileManager.markSelected('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: true });
    tileManager.markShown('base/12/2500/2500');
    const frameResult = tileManager.endFrame();

    expect(frameResult.hiddenKeys).toEqual([]);
    expect(frameResult.unloadableKeys).toEqual([]);

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      eligibleForUnloading: false,
      state: 'shown',
    });
  });

  it('should unload fallback tiles after new tiles are loaded', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    tileManager.markSelected('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: true });
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    tileManager.beginFrame(3);
    tileManager.markShown('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: false });
    const frameResult = tileManager.endFrame();

    expect(frameResult.hiddenKeys).toEqual(['base/12/2500/2500']);
    expect(frameResult.unloadableKeys).toEqual([]);

    tileManager.beginFrame(4);
    const finalFrameResult = tileManager.endFrame();

    expect(finalFrameResult.unloadableKeys).toEqual(['base/12/2500/2500']);
  });
});
