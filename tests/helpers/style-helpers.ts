import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

export function createMockStyle(type: 'fill' | 'line' | 'circle'): StyleSpecification {
  return {
    version: 8 as const,
    sources: {},
    layers: [
      {
        'id': 'layer1',
        type,
        'source': 'source',
        'source-layer': 'layer',
        'paint':
          type === 'fill'
            ? { 'fill-color': '#ff0000' }
            : type === 'line'
              ? { 'line-color': '#00ff00' }
              : { 'circle-color': '#0000ff' },
      },
    ],
  } as StyleSpecification;
}
