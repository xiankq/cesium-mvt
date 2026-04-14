import type {
  GeoJSONSourceSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStyleSet, normalizeStyle } from '@/mvt/style/style-loader';

const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nqkAAAAASUVORK5CYII=';

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

  it('loads a style url and only keeps live style fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.endsWith('/style.json')) {
          return new Response(JSON.stringify({
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
          }));
        }

        if (url.endsWith('/sprite.json')) {
          return new Response(JSON.stringify({
            stripe: {
              height: 4,
              pixelRatio: 1,
              x: 0,
              y: 0,
              width: 8,
            },
          }));
        }

        if (url.endsWith('/sprite.png')) {
          return new Response(
            base64ToBytes(TEST_PNG_BASE64).buffer as ArrayBuffer,
          );
        }

        throw new Error(`unexpected fetch url: ${url}`);
      }),
    );

    const styleSet = await loadStyleSet({
      style: 'https://example.com/styles/basic/style.json',
    });

    expect(styleSet).not.toHaveProperty('styleUrl');
    expect(styleSet).not.toHaveProperty('backgroundColor');
    expect(styleSet.style.sprite).toBe('https://example.com/styles/basic/sprite');
  });

  it('loads sprite atlas images for pattern and icon lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.endsWith('/style.json')) {
          return new Response(JSON.stringify({
            version: 8,
            sources: {},
            sprite: './sprite',
            layers: [],
          }));
        }

        if (url.endsWith('/sprite.json')) {
          return new Response(JSON.stringify({
            stripe: {
              height: 4,
              pixelRatio: 1,
              x: 0,
              y: 0,
              width: 8,
            },
          }));
        }

        if (url.endsWith('/sprite.png')) {
          return new Response(
            base64ToBytes(TEST_PNG_BASE64).buffer as ArrayBuffer,
          );
        }

        throw new Error(`unexpected fetch url: ${url}`);
      }),
    );

    const styleSet = await loadStyleSet({
      style: 'https://example.com/styles/basic/style.json',
    });

    const spriteImage = styleSet.style.spriteAtlas?.getImage('stripe');

    expect(spriteImage).toBeDefined();
    expect(spriteImage?.image).toContain('data:image/svg+xml');
    expect(spriteImage?.width).toBe(8);
    expect(spriteImage?.height).toBe(4);
  });

  it('loads sprite atlas for inline style objects too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.endsWith('/sprite.json')) {
          return new Response(JSON.stringify({
            stripe: {
              height: 4,
              pixelRatio: 1,
              x: 0,
              y: 0,
              width: 8,
            },
          }));
        }

        if (url.endsWith('/sprite.png')) {
          return new Response(
            base64ToBytes(TEST_PNG_BASE64).buffer as ArrayBuffer,
          );
        }

        throw new Error(`unexpected fetch url: ${url}`);
      }),
    );

    const styleSet = await loadStyleSet({
      style: {
        version: 8,
        sources: {},
        sprite: 'https://example.com/styles/basic/sprite',
        layers: [],
      },
    });

    const spriteImage = styleSet.style.spriteAtlas?.getImage('stripe');

    expect(spriteImage).toBeDefined();
    expect(spriteImage?.width).toBe(8);
    expect(spriteImage?.height).toBe(4);
  });
});

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
