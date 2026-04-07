import type { TextSpriteRequest } from '../src/mvt/render/text';
import { Color } from 'cesium';
import { describe, expect, it } from 'vitest';
import { TextSpriteAtlas } from '../src/mvt/render/text';

function createRequest(
  overrides: Partial<TextSpriteRequest> = {},
): TextSpriteRequest {
  return {
    text: 'Alpha',
    textAnchor: 'center',
    textSize: 12,
    fontStack: ['Open Sans Regular'],
    textColor: Color.WHITE,
    haloColor: Color.BLACK,
    haloWidth: 0,
    haloBlur: 0,
    textPadding: 2,
    textLineHeight: 1.2,
    textLetterSpacing: 0,
    textJustify: 'center',
    devicePixelRatio: 1,
    ...overrides,
  };
}

describe('textSpriteAtlas', () => {
  it('caps buckets, layouts, and retained entry images', () => {
    const atlas = new TextSpriteAtlas({
      pageCssSize: 64,
      maxBuckets: 2,
      maxLayouts: 3,
      maxEntries: 3,
      maxEntriesPerBucket: 2,
    });

    atlas.resolveImage(createRequest({ text: 'Alpha', fontStack: ['A'] }));
    atlas.resolveImage(createRequest({ text: 'Beta', fontStack: ['A'] }));
    atlas.resolveImage(createRequest({ text: 'Gamma', fontStack: ['A'] }));
    atlas.resolveImage(createRequest({ text: 'Delta', fontStack: ['B'] }));
    atlas.resolveImage(createRequest({ text: 'Epsilon', fontStack: ['C'] }));

    const stats = atlas.getStats();
    expect(stats.bucketCount).toBe(2);
    expect(stats.layoutCount).toBe(3);
    expect(stats.entryCount).toBeLessThanOrEqual(3);
  });

  it('reuses a bounded scratch page after the bucket fills up', () => {
    const atlas = new TextSpriteAtlas({
      pageCssSize: 48,
      maxBuckets: 1,
      maxLayouts: 16,
      maxEntries: 8,
      maxEntriesPerBucket: 8,
    });

    const images = Array.from({ length: 6 }, (_, index) =>
      atlas.resolveImage(
        createRequest({
          text: `T${index}`,
        }),
      ));

    expect(images.every(image => image !== undefined)).toBe(true);
    expect(atlas.getStats()).toEqual({
      bucketCount: 1,
      layoutCount: 6,
      entryCount: 6,
    });
  });
});
