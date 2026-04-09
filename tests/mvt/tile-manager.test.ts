import { describe, expect, it } from 'vitest';
import { TileManager } from '../../src/mvt/source/tile-manager';

describe('tile-manager', () => {
  it('marks shown tiles as hidden before they become unloadable', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/1/2/3');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    const secondFrameResult = tileManager.endFrame();

    expect(secondFrameResult.hiddenKeys).toEqual(['base/1/2/3']);
    expect(secondFrameResult.unloadableKeys).toEqual(['base/1/2/3']);
    expect(tileManager.getTile('base/1/2/3')).toMatchObject({
      eligibleForUnloading: true,
      key: 'base/1/2/3',
      state: 'hidden',
    });
  });

  it('keeps touched hidden tiles out of the unloadable set', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/1/2/3');
    tileManager.endFrame();

    tileManager.beginFrame(2);
    tileManager.touch('base/1/2/3');
    const secondFrameResult = tileManager.endFrame();

    expect(secondFrameResult.hiddenKeys).toEqual(['base/1/2/3']);
    expect(secondFrameResult.unloadableKeys).toEqual([]);
    expect(tileManager.getTile('base/1/2/3')).toMatchObject({
      eligibleForUnloading: false,
      key: 'base/1/2/3',
      state: 'hidden',
    });
  });

  it('treats request and upload blockers as non-unloadable conditions', () => {
    const tileManager = new TileManager();

    tileManager.beginFrame(1);
    tileManager.markShown('base/1/2/3');
    tileManager.endFrame();

    tileManager.setBlockers('base/1/2/3', {
      requesting: true,
      uploading: true,
    });
    tileManager.beginFrame(2);
    const secondFrameResult = tileManager.endFrame();

    expect(secondFrameResult.hiddenKeys).toEqual(['base/1/2/3']);
    expect(secondFrameResult.unloadableKeys).toEqual([]);
    expect(tileManager.getTile('base/1/2/3')).toMatchObject({
      blockers: {
        parsing: false,
        pick: false,
        placement: false,
        requesting: true,
        uploading: true,
      },
      eligibleForUnloading: false,
      key: 'base/1/2/3',
      state: 'hidden',
    });
  });
});
