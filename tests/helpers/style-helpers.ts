import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

export interface MockStyleOptions {
  layerId?: string;
}

export function createMockStyle(type: 'fill' | 'line' | 'circle', options: MockStyleOptions = {}): StyleSpecification {
  const { layerId = 'layer1' } = options;

  return {
    version: 8 as const,
    sources: {},
    layers: [
      {
        'id': layerId,
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
