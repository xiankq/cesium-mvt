import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Rectangle, WebMercatorTilingScheme } from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CesiumVectorTileCoordinator } from '@/mvt/cesium-vector-tile-coordinator';

describe('cesiumVectorTileCoordinator - 不支持的 source 类型', () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('应该忽略不支持的 source 类型（如 raster）而不抛出错误', async () => {
    const coordinator = new CesiumVectorTileCoordinator({
      minimumLevel: 0,
      rectangle: Rectangle.MAX_VALUE,
      root: {
        add: vi.fn(),
        remove: vi.fn(),
      } as any,
      tileWidth: 256,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    const style: StyleSpecification = {
      version: 8,
      sources: {
        ne2_shaded: {
          type: 'raster',
          tiles: ['https://example.com/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
        vector_source: {
          type: 'vector',
          tiles: ['https://example.com/vector/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'raster_layer',
          type: 'raster',
          source: 'ne2_shaded',
        },
        {
          'id': 'vector_layer',
          'type': 'line',
          'source': 'vector_source',
          'source-layer': 'layer',
        },
      ],
    };

    coordinator.updateStyle(style);

    const frameState = {
      camera: {
        position: { x: 0, y: 0, z: 6378137 },
        direction: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
        computeViewRectangle: vi.fn(() => new Rectangle(
          -Math.PI / 4,
          -Math.PI / 4,
          Math.PI / 4,
          Math.PI / 4,
        )),
      },
      viewportWidth: 1920,
    };

    coordinator.update(frameState);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    coordinator.destroy();
  });

  it('应该只处理支持的 source 类型', () => {
    const coordinator = new CesiumVectorTileCoordinator({
      minimumLevel: 0,
      rectangle: Rectangle.MAX_VALUE,
      root: {
        add: vi.fn(),
        remove: vi.fn(),
      } as any,
      tileWidth: 256,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    const style: StyleSpecification = {
      version: 8,
      sources: {
        geojson_source: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'circle_layer',
          type: 'circle',
          source: 'geojson_source',
        },
      ],
    };

    coordinator.updateStyle(style);

    const frameState = {
      camera: {
        position: { x: 0, y: 0, z: 6378137 },
        direction: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
        computeViewRectangle: vi.fn(() => new Rectangle(
          -Math.PI / 4,
          -Math.PI / 4,
          Math.PI / 4,
          Math.PI / 4,
        )),
      },
      viewportWidth: 1920,
    };

    expect(() => coordinator.update(frameState)).not.toThrow();

    coordinator.destroy();
  });
});
