import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import Point from '@mapbox/point-geometry';
import { PrimitiveCollection } from 'cesium';
import { describe, expect, it } from 'vitest';
import {
  createRenderedTileHandle,
  destroyRenderedTileHandle,
  mountRenderedTileHandle,
  setRenderedTileVisibility,
} from '@/mvt/render/rendered-tile';

describe('rendered-tile', () => {
  it('creates a combined render handle and manages collection visibility and mounting', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        shapes: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'poi',
          type: 'circle',
          source: 'shapes',
        },
        {
          id: 'road',
          type: 'line',
          source: 'shapes',
        },
        {
          id: 'land',
          type: 'fill',
          source: 'shapes',
        },
      ],
    };
    const root = new PrimitiveCollection();

    const handle = createRenderedTileHandle({
      featureTile: {
        epoch: 1,
        geometryBatches: [
          {
            backend: 'circle',
            extent: 4096,
            familyId: 'shapes/_geojson/circle/0',
            featureCount: 1,
            features: [
              {
                geometry: [[new Point(2048, 2048)]],
                id: 1,
                properties: {},
                type: 'point',
              },
            ],
            layerIds: ['poi'],
            order: 0,
            sourceId: 'shapes',
            sourceLayer: '_geojson',
            type: 'circle',
          },
          {
            backend: 'line',
            extent: 4096,
            familyId: 'shapes/_geojson/line/1',
            featureCount: 1,
            features: [
              {
                geometry: [[new Point(1024, 2048), new Point(3072, 2048)]],
                id: 2,
                properties: {},
                type: 'line',
              },
            ],
            layerIds: ['road'],
            order: 1,
            sourceId: 'shapes',
            sourceLayer: '_geojson',
            type: 'line',
          },
          {
            backend: 'fill',
            extent: 4096,
            familyId: 'shapes/_geojson/fill/2',
            featureCount: 1,
            features: [
              {
                geometry: [[
                  new Point(1024, 1024),
                  new Point(3072, 1024),
                  new Point(3072, 3072),
                  new Point(1024, 3072),
                  new Point(1024, 1024),
                ]],
                id: 3,
                properties: {},
                type: 'polygon',
              },
            ],
            layerIds: ['land'],
            order: 2,
            sourceId: 'shapes',
            sourceLayer: '_geojson',
            type: 'fill',
          },
        ],
        key: 'shapes/0/0/0@1',
      },
      level: 0,
      style,
      x: 0,
      y: 0,
    });

    expect(handle.byteLength).toBeGreaterThan(0);
    expect(handle.circles?.collections).toHaveLength(1);
    expect(handle.lines?.collections).toHaveLength(1);
    expect(handle.fills?.collections).toHaveLength(1);

    mountRenderedTileHandle(root, handle);

    expect(root.length).toBe(3);

    setRenderedTileVisibility(handle, false);
    expect(handle.circles?.collections[0]?.collection.show).toBe(false);
    expect(handle.lines?.collections[0]?.collection.show).toBe(false);
    expect(handle.fills?.collections[0]?.collection.show).toBe(false);

    setRenderedTileVisibility(handle, true);
    expect(handle.circles?.collections[0]?.collection.show).toBe(true);
    expect(handle.lines?.collections[0]?.collection.show).toBe(true);
    expect(handle.fills?.collections[0]?.collection.show).toBe(true);

    destroyRenderedTileHandle(root, handle);
    expect(root.length).toBe(0);
  });

  it('mounts mixed geometry collections in style layer order', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        shapes: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'land',
          type: 'fill',
          source: 'shapes',
        },
        {
          id: 'poi',
          type: 'circle',
          source: 'shapes',
        },
        {
          id: 'road',
          type: 'line',
          source: 'shapes',
        },
      ],
    };
    const root = new PrimitiveCollection();

    const handle = createRenderedTileHandle({
      featureTile: {
        epoch: 1,
        geometryBatches: [
          {
            backend: 'fill',
            extent: 4096,
            familyId: 'shapes/_geojson/fill/0',
            featureCount: 1,
            features: [
              {
                geometry: [[
                  new Point(1024, 1024),
                  new Point(3072, 1024),
                  new Point(3072, 3072),
                  new Point(1024, 3072),
                  new Point(1024, 1024),
                ]],
                id: 1,
                properties: {},
                type: 'polygon',
              },
            ],
            layerIds: ['land'],
            order: 0,
            sourceId: 'shapes',
            sourceLayer: '_geojson',
            type: 'fill',
          },
          {
            backend: 'circle',
            extent: 4096,
            familyId: 'shapes/_geojson/circle/1',
            featureCount: 1,
            features: [
              {
                geometry: [[new Point(2048, 2048)]],
                id: 2,
                properties: {},
                type: 'point',
              },
            ],
            layerIds: ['poi'],
            order: 1,
            sourceId: 'shapes',
            sourceLayer: '_geojson',
            type: 'circle',
          },
          {
            backend: 'line',
            extent: 4096,
            familyId: 'shapes/_geojson/line/2',
            featureCount: 1,
            features: [
              {
                geometry: [[new Point(1024, 2048), new Point(3072, 2048)]],
                id: 3,
                properties: {},
                type: 'line',
              },
            ],
            layerIds: ['road'],
            order: 2,
            sourceId: 'shapes',
            sourceLayer: '_geojson',
            type: 'line',
          },
        ],
        key: 'shapes/0/0/0@1',
      },
      level: 0,
      style,
      x: 0,
      y: 0,
    });

    mountRenderedTileHandle(root, handle);

    expect(root.get(0)).toBe(handle.fills?.collections[0]?.collection);
    expect(root.get(1)).toBe(handle.circles?.collections[0]?.collection);
    expect(root.get(2)).toBe(handle.lines?.collections[0]?.collection);

    destroyRenderedTileHandle(root, handle);
  });
});
