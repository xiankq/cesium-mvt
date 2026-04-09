import { describe, expect, it } from 'vitest';
import { DefaultTileLoader } from '../src/mvt/tile/tile-loader';

describe('tile-loader', () => {
  it('builds tile url from template placeholders', () => {
    const tileLoader = new DefaultTileLoader({
      tileTemplate: 'https://example.com/{z}/{x}/{reverseY}/{reverseX}.pbf',
    });

    expect(tileLoader.buildTileUrl({ x: 3, y: 5, z: 4 })).toBe('https://example.com/4/3/10/12.pbf');
  });

  it('loads tile array buffer through injected fetcher', async () => {
    const tileLoader = new DefaultTileLoader({
      fetch: async (input) => {
        expect(input).toBe('https://example.com/2/1/2.pbf');
        return new Response(new Uint8Array([1, 2, 3, 4]));
      },
      tileTemplate: 'https://example.com/{z}/{x}/{y}.pbf',
    });

    const tileResult = await tileLoader.loadTile({ x: 1, y: 2, z: 2 });

    expect(tileResult.url).toBe('https://example.com/2/1/2.pbf');
    expect(tileResult.byteLength).toBe(4);
    expect(new Uint8Array(tileResult.arrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
