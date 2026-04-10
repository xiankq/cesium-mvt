import { describe, expect, it } from 'vitest';
import { TileManager } from '@/mvt/source/tile-manager';

describe('tile-manager parent-child retention', () => {
  it('should retain parent tiles when children are loading', () => {
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
    tileManager.markSelected('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: true });
    const frameResult = tileManager.endFrame();

    expect(frameResult.unloadableKeys).toEqual([]);
    expect(tileManager.getTile('base/12/2500/2500')?.eligibleForUnloading).toBe(false);
  });

  it('should mark parent tiles as unloadable when children are ready', () => {
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

    tileManager.beginFrame(4);
    const finalFrameResult = tileManager.endFrame();

    expect(finalFrameResult.unloadableKeys).toEqual(['base/12/2500/2500']);
  });

  it('should retain ancestor tiles when intermediate tiles are empty', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/10/625/625');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    tileManager.markSelected('base/14/10000/10000');
    tileManager.setBlockers('base/14/10000/10000', { requesting: true });
    tileManager.markSelected('base/12/2500/2500');
    tileManager.setBlockers('base/12/2500/2500', { requesting: false });
    tileManager.markShown('base/10/625/625');
    tileManager.endFrame();

    const tile12 = tileManager.getTile('base/12/2500/2500');
    const tile10 = tileManager.getTile('base/10/625/625');

    expect(tile12?.eligibleForUnloading).toBe(false);
    expect(tile10?.eligibleForUnloading).toBe(false);
  });
});
