import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point } from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { describe, expect, it, vi } from 'vitest';
import { queryRenderedFeaturesFromState } from '@/mvt/render/render-query';

function createTileBuffer() {
  const data: FeatureCollection<Point, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          kind: 'cafe',
        },
      },
    ],
  };

  const tileIndex = new GeoJSONVT(data);
  const tile = tileIndex.getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  const encoded = fromGeojsonVt({ poi: tile } as Parameters<typeof fromGeojsonVt>[0]);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

function createSpatialTileBuffer() {
  const data: FeatureCollection<Point, { kind: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          kind: 'left',
        },
      },
      {
        type: 'Feature',
        id: 2,
        geometry: {
          type: 'Point',
          coordinates: [90, 0],
        },
        properties: {
          kind: 'right',
        },
      },
    ],
  };

  const tileIndex = new GeoJSONVT(data);
  const tile = tileIndex.getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  const encoded = fromGeojsonVt({ poi: tile } as Parameters<typeof fromGeojsonVt>[0]);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

function createDonutTileBuffer() {
  const tile = {
    features: [
      {
        id: 1,
        geometry: [
          [
            [0, 0],
            [4096, 0],
            [4096, 4096],
            [0, 4096],
            [0, 0],
          ],
          [
            [1500, 1500],
            [2500, 1500],
            [2500, 2500],
            [1500, 2500],
            [1500, 1500],
          ],
        ],
        properties: {
          kind: 'donut',
        },
        type: 3,
      },
    ],
    transformed: true,
  };

  const encoded = fromGeojsonVt({ area: tile } as unknown as Parameters<typeof fromGeojsonVt>[0]);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

describe('render-query', () => {
  it('应该返回可见瓦片中满足 layer 和 filter 的渲染要素', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };

    const tileBuffer = createTileBuffer();
    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => ({
        getEntry: vi.fn(() => ({
          state: 'ready',
          value: tileBuffer,
        })),
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: true,
        })),
      },
      style,
    }, {
      filter: ['==', ['get', 'kind'], 'cafe'],
    });

    expect(renderedFeatures).toHaveLength(1);
    expect(renderedFeatures[0]).toMatchObject({
      id: 1,
      layerId: 'poi',
      properties: {
        kind: 'cafe',
      },
      sourceId: 'base',
      sourceLayer: 'poi',
      type: 'Feature',
    });
    expect(renderedFeatures[0]?.geometry).toMatchObject({
      type: 'Point',
    });
  });

  it('应该在 queryRenderedFeatures 中读取 feature-state', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'paint': {
            'circle-color': '#ff0000',
          },
          'source': 'base',
          'source-layer': 'poi',
          'type': 'circle',
          'filter': ['==', ['feature-state', 'selected'], true] as any,
        },
      ],
    };

    const tileBuffer = createTileBuffer();
    const renderedFeatures = queryRenderedFeaturesFromState({
      getFeatureState: vi.fn(() => ({
        selected: true,
      })),
      getSourceCache: vi.fn(() => ({
        getEntry: vi.fn(() => ({
          state: 'ready',
          value: tileBuffer,
        })),
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: true,
        })),
      },
      style,
    });

    expect(renderedFeatures).toHaveLength(1);
    expect(renderedFeatures[0]).toMatchObject({
      id: 1,
      layerId: 'poi',
      properties: {
        kind: 'cafe',
      },
      sourceId: 'base',
      sourceLayer: 'poi',
      type: 'Feature',
    });
  });

  it('应该兼容带 styleEpoch 前缀和后缀的渲染瓦片 key', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };

    const tileBuffer = createTileBuffer();
    const getEntry = vi.fn(() => ({
      state: 'ready',
      value: tileBuffer,
    }));
    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => ({
        getEntry,
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0@1']),
        getHandle: vi.fn(() => ({
          visible: true,
        })),
      },
      style,
    }, {
      filter: ['==', ['get', 'kind'], 'cafe'],
    });

    expect(getEntry).toHaveBeenCalledWith('base/0/0/0');
    expect(renderedFeatures).toHaveLength(1);
    expect(renderedFeatures[0]).toMatchObject({
      id: 1,
      layerId: 'poi',
      properties: {
        kind: 'cafe',
      },
      sourceId: 'base',
      sourceLayer: 'poi',
      type: 'Feature',
    });
  });

  it('应该忽略隐藏瓦片', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };

    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => undefined),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: false,
        })),
      },
      style,
    });

    expect(renderedFeatures).toEqual([]);
  });

  it('应该通过空间查询只返回命中范围内的渲染要素', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };

    const tileBuffer = createSpatialTileBuffer();
    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => ({
        getEntry: vi.fn(() => ({
          state: 'ready',
          value: tileBuffer,
        })),
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: true,
        })),
      },
      style,
    }, {
      geometry: {
        maxX: 2500,
        maxY: 2500,
        minX: 1900,
        minY: 1900,
        type: 'box',
      },
    });

    expect(renderedFeatures).toHaveLength(1);
    expect(renderedFeatures[0]).toMatchObject({
      id: 1,
      layerId: 'poi',
      properties: {
        kind: 'left',
      },
      sourceId: 'base',
      sourceLayer: 'poi',
    });
  });

  it('应该在 symbol placement 为空时跳过 symbol 查询', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'symbol',
          'source': 'base',
          'source-layer': 'poi',
          'layout': {
            'text-field': ['get', 'name'],
          },
        },
      ],
    };

    const tileBuffer = createSpatialTileBuffer();
    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => ({
        getEntry: vi.fn(() => ({
          state: 'ready',
          value: tileBuffer,
        })),
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: true,
          symbols: {
            placements: [],
          },
        })),
      },
      style,
    });

    expect(renderedFeatures).toEqual([]);
  });

  it('应该按真实几何而不是包围盒过滤空间查询', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'area',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'area',
        },
      ],
    };

    const tileBuffer = createDonutTileBuffer();
    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => ({
        getEntry: vi.fn(() => ({
          state: 'ready',
          value: tileBuffer,
        })),
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: true,
        })),
      },
      style,
    }, {
      geometry: {
        maxX: 2400,
        maxY: 2400,
        minX: 1600,
        minY: 1600,
        type: 'box',
      },
    });

    expect(renderedFeatures).toEqual([]);
  });

  it('应该只返回可见的 symbol placement 对应要素', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'symbol',
          'source': 'base',
          'source-layer': 'poi',
          'layout': {
            'text-field': ['get', 'name'],
          },
        },
      ],
    };

    const tileBuffer = createSpatialTileBuffer();
    const renderedFeatures = queryRenderedFeaturesFromState({
      getSourceCache: vi.fn(() => ({
        getEntry: vi.fn(() => ({
          state: 'ready',
          value: tileBuffer,
        })),
      })),
      renderManager: {
        getAllKeys: vi.fn(() => ['0:base/0/0/0']),
        getHandle: vi.fn(() => ({
          visible: true,
          symbols: {
            placements: [
              {
                key: 'base|poi|left',
                layerId: 'poi',
                renderables: [
                  {
                    collection: {
                      get: vi.fn(() => ({ show: false })),
                    },
                    index: 0,
                  },
                  {
                    collection: {
                      get: vi.fn(() => ({ show: true })),
                    },
                    index: 1,
                  },
                ],
                sourceIndex: 0,
                sourceLayer: 'poi',
              },
              {
                key: 'base|poi|right',
                layerId: 'poi',
                renderables: [
                  {
                    collection: {
                      get: vi.fn(() => ({ show: false })),
                    },
                    index: 0,
                  },
                  {
                    collection: {
                      get: vi.fn(() => ({ show: false })),
                    },
                    index: 1,
                  },
                ],
                sourceIndex: 1,
                sourceLayer: 'poi',
              },
            ],
          },
        })),
      },
      style,
    }, {
      geometry: {
        maxX: 4096,
        maxY: 4096,
        minX: 0,
        minY: 0,
        type: 'box',
      },
    });

    expect(renderedFeatures).toHaveLength(1);
    expect(renderedFeatures[0]).toMatchObject({
      id: 1,
      layerId: 'poi',
      properties: {
        kind: 'left',
      },
      sourceId: 'base',
      sourceLayer: 'poi',
      type: 'Feature',
    });
  });
});
