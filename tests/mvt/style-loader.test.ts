import type {
  GeoJSONSourceSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStyleSet, normalizeStyle } from '@/mvt/style/style-loader';

describe('style-loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves relative asset urls against the style url', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          url: '../tiles/tilejson.json',
          tiles: ['./{z}/{x}/{y}.pbf'],
        },
        data: {
          type: 'geojson',
          data: '../data/world.geojson',
        },
      },
      sprite: './sprite',
      glyphs: '../glyphs/{fontstack}/{range}.pbf',
      layers: [],
    };

    const normalized = normalizeStyle(
      style,
      'https://example.com/styles/basic/style.json',
    );

    expect(normalized.style.sprite).toBe('https://example.com/styles/basic/sprite');
    expect(normalized.style.glyphs).toBe('https://example.com/styles/glyphs/{fontstack}/{range}.pbf');
    expect((normalized.style.sources.base as VectorSourceSpecification).url).toBe('https://example.com/styles/tiles/tilejson.json');
    expect((normalized.style.sources.base as VectorSourceSpecification).tiles).toEqual([
      'https://example.com/styles/basic/{z}/{x}/{y}.pbf',
    ]);
    expect((normalized.style.sources.data as GeoJSONSourceSpecification).data).toBe('https://example.com/styles/data/world.geojson');
  });

  it('loads a style url and extracts the background color', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        version: 8,
        sources: {},
        sprite: './sprite',
        glyphs: './glyphs/{fontstack}/{range}.pbf',
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#123456',
            },
          },
        ],
      }))),
    );

    const styleSet = await loadStyleSet({
      style: 'https://example.com/styles/basic/style.json',
    });

    expect(styleSet.styleUrl).toBe('https://example.com/styles/basic/style.json');
    expect(styleSet.backgroundColor).toBe('#123456');
    expect(styleSet.style.sprite).toBe('https://example.com/styles/basic/sprite');
  });
});
