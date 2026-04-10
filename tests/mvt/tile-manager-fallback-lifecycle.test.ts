import { describe, expect, it } from 'vitest';
import { TileManager } from '@/mvt/source/tile-manager';

describe('tile-manager fallback lifecycle', () => {
  it('should keep fallback tiles shown while new tiles are loading', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      state: 'shown',
      eligibleForUnloading: false,
    });

    tileManager.beginFrame(2);
    tileManager.markSelected('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: true });
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      state: 'shown',
      eligibleForUnloading: false,
    });

    tileManager.beginFrame(3);
    tileManager.markSelected('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: true });
    tileManager.markShown('base/12/2500/2500');
    tileManager.endFrame();

    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      state: 'shown',
      eligibleForUnloading: false,
    });
  });

  it('should hide fallback tiles after new tiles are ready', () => {
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
    expect(tileManager.getTile('base/12/2500/2500')).toMatchObject({
      state: 'hidden',
      eligibleForUnloading: false,
    });

    tileManager.beginFrame(4);
    const finalFrameResult = tileManager.endFrame();

    expect(finalFrameResult.unloadableKeys).toEqual(['base/12/2500/2500']);
  });
});
