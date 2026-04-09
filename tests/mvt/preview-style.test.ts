import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  appendPreviewCircleLayer,
  ensurePreviewCircleLayer,
} from '../../src/mvt/style/preview-style';

describe('preview-style', () => {
  it('appends a preview circle layer without mutating the input style', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.example.com/planet',
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
        },
      ],
    };

    const nextStyle = appendPreviewCircleLayer(style, {
      id: 'preview-place-circle',
      sourceId: 'openmaptiles',
      sourceLayer: 'place',
    });

    expect(style.layers).toEqual([
      {
        id: 'background',
        type: 'background',
      },
    ]);
    expect(nextStyle.layers.at(-1)).toEqual({
      'id': 'preview-place-circle',
      'paint': {
        'circle-color': '#ff3b30',
        'circle-opacity': 0.9,
        'circle-radius': 4,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
      'source': 'openmaptiles',
      'source-layer': 'place',
      'type': 'circle',
    });
  });

  it('replaces an existing preview layer with the same id', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.example.com/planet',
        },
      },
      layers: [
        {
          'id': 'preview-place-circle',
          'type': 'circle',
          'source': 'openmaptiles',
          'source-layer': 'place',
        },
      ],
    };

    const nextStyle = appendPreviewCircleLayer(style, {
      id: 'preview-place-circle',
      sourceId: 'openmaptiles',
      sourceLayer: 'place',
    });

    expect(nextStyle.layers).toHaveLength(1);
    expect(nextStyle.layers[0]).toMatchObject({
      id: 'preview-place-circle',
      type: 'circle',
    });
  });

  it('appends an internal preview layer for symbol-backed vector styles', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.example.com/planet',
        },
      },
      layers: [
        {
          'id': 'label-city',
          'type': 'symbol',
          'source': 'openmaptiles',
          'source-layer': 'place',
        },
      ],
    };

    const nextStyle = ensurePreviewCircleLayer(style);

    expect(nextStyle.layers.at(-1)).toMatchObject({
      'id': '__cesium-mvt-preview-circle__',
      'source': 'openmaptiles',
      'source-layer': 'place',
      'type': 'circle',
    });
  });

  it('keeps styles with circle layers unchanged', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.example.com/planet',
        },
      },
      layers: [
        {
          'id': 'poi-circle',
          'type': 'circle',
          'source': 'openmaptiles',
          'source-layer': 'poi',
        },
      ],
    };

    expect(ensurePreviewCircleLayer(style)).toBe(style);
  });
});
