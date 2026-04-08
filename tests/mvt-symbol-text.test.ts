import type { MvtCompiledStyleLayer } from '../src/mvt/mvt-types';
import { describe, expect, it } from 'vitest';
import { extractPlainTextValue, resolveTextBlock } from '../src/mvt/render/mvt-symbol-text';

const baseLayer: MvtCompiledStyleLayer = {
  filterEvaluator: () => true,
  filterKey: 'null',
  id: 'symbol-test',
  layout: {},
  layoutKey: '{}',
  order: 0,
  paint: {},
  type: 'symbol',
  visibility: 'visible',
};

describe('mvt-symbol-text', () => {
  it('extracts plain text from formatted text-field values', () => {
    const text = extractPlainTextValue({
      sections: [
        { text: 'Latin' },
        { text: '\n' },
        { text: '中文' },
      ],
    }, baseLayer, 'text-field');

    expect(text).toBe('Latin\n中文');
  });

  it('builds centered multiline text blocks', () => {
    const textBlock = resolveTextBlock('Latin\n中文', 12, 1, 0, 1.2);

    expect(textBlock?.lines).toEqual(['Latin', '中文']);
    expect(textBlock?.height).toBeGreaterThan(12);
    expect(textBlock?.width).toBeGreaterThan(12);
  });
});
