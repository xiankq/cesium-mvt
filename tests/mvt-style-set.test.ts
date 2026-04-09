import { describe, expect, it } from 'vitest';
import { MvtStyleSet } from '../src/mvt/style/mvt-style-set';
import { loadOpenFreeMapBrightStyle, loadOpenFreeMapBrightStyleSet, openFreeMapBrightSourceId } from './openfreemap-bright-style';

describe('mvt-style-set', () => {
  it('loads openfreemap bright style and resolves its vector tile template', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();

    expect(styleSet.sourceId).toBe(openFreeMapBrightSourceId);
    expect(styleSet.getSourceTileTemplate()).toContain('/{z}/{x}/{y}.pbf');
    expect(styleSet.backgroundColor).toBe('#f8f4f0');
    expect(styleSet.families.length).toBeGreaterThan(0);
    expect(styleSet.families.some(family => family.type === 'fill')).toBe(true);
    expect(styleSet.families.some(family => family.type === 'line')).toBe(true);
    expect(styleSet.families.some(family => family.type === 'symbol')).toBe(true);
    expect(styleSet.getCompiledLayer('building')?.type).toBe('fill');
    expect(styleSet.spriteAtlas?.entries.has('airport_11')).toBe(true);
  });

  it('keeps zoom filtering consistent for openfreemap bright style', async () => {
    const styleSpecification = await loadOpenFreeMapBrightStyle();
    const styleSet = await MvtStyleSet
      .fromSpecification(styleSpecification, {
        baseUrl: 'https://tiles.openfreemap.org/styles/bright',
        source: openFreeMapBrightSourceId,
      })
      .resolveVectorSource(fetch);

    expect(styleSet.getVisibleFamilies(0).length).toBeLessThan(styleSet.getVisibleFamilies(14).length);
    expect(styleSet.getVisibleFamilies(14).every((family) => {
      return family.layers.some(layer => styleSet.isLayerVisibleAtZoom(layer, 14));
    })).toBe(true);
  });
});
