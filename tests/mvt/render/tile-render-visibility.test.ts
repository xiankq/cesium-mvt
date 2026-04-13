import type { TileRenderVisibilityOptions } from '@/mvt/render/tile-render-visibility';
import { describe, expect, it } from 'vitest';
import {
  compileTileRenderVisibility,

} from '@/mvt/render/tile-render-visibility';

describe('tile-render-visibility', () => {
  describe('compileTileRenderVisibility', () => {
    it('returns visible when tile has data and is within zoom range', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 10,
        hasData: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(compileTileRenderVisibility(options)).toBe('visible');
    });

    it('returns hidden when tile has no data', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 10,
        hasData: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(compileTileRenderVisibility(options)).toBe('hidden');
    });

    it('returns hidden when tile zoom is below source minzoom', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 4,
        hasData: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(compileTileRenderVisibility(options)).toBe('hidden');
    });

    it('returns visible when tile zoom is above source maxzoom (overzoomed)', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 15,
        hasData: true,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(compileTileRenderVisibility(options)).toBe('visible');
    });

    it('returns visible when minzoom is undefined and zoom is within maxzoom', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 10,
        hasData: true,
        sourceConstraints: { maxZoom: 14 },
      };

      expect(compileTileRenderVisibility(options)).toBe('visible');
    });

    it('returns visible when maxzoom is undefined and zoom is above minzoom', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 10,
        hasData: true,
        sourceConstraints: { minZoom: 5 },
      };

      expect(compileTileRenderVisibility(options)).toBe('visible');
    });

    it('returns visible when both minzoom and maxzoom are undefined', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 10,
        hasData: true,
        sourceConstraints: {},
      };

      expect(compileTileRenderVisibility(options)).toBe('visible');
    });

    it('returns hidden when tile is empty (byteLength is 0)', () => {
      const options: TileRenderVisibilityOptions = {
        currentZoom: 10,
        hasData: false,
        sourceConstraints: { maxZoom: 14, minZoom: 5 },
      };

      expect(compileTileRenderVisibility(options)).toBe('hidden');
    });
  });
});
