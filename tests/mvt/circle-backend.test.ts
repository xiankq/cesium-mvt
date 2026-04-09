import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import Point from '@mapbox/point-geometry';
import {
  BufferPoint,
  BufferPointMaterial,
  Cartesian3,
  Color,
} from 'cesium';
import { describe, expect, it } from 'vitest';
import { createCircleTileHandle } from '../../src/mvt/render/backend/circle-backend';

describe('circle-backend', () => {
  it('creates one buffer collection per circle layer and projects points onto the globe', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'poi-shadow',
          type: 'circle',
          source: 'places',
          paint: {
            'circle-color': '#000000',
            'circle-opacity': 0.25,
            'circle-radius': 7,
          },
        },
        {
          id: 'poi',
          type: 'circle',
          source: 'places',
          paint: {
            'circle-color': '#ff0000',
            'circle-radius': 5,
          },
        },
      ],
    };

    const handle = createCircleTileHandle({
      featureTile: {
        epoch: 1,
        geometryBatches: [
          {
            backend: 'circle',
            extent: 4096,
            familyId: 'places/_geojson/circle/0',
            featureCount: 1,
            features: [
              {
                geometry: [[new Point(2048, 2048)]],
                id: 12,
                properties: {
                  name: 'center',
                },
                type: 'point',
              },
            ],
            layerIds: ['poi-shadow', 'poi'],
            order: 0,
            sourceId: 'places',
            sourceLayer: '_geojson',
            type: 'circle',
          },
        ],
        key: 'places/0/0/0@1',
      },
      level: 0,
      style,
      x: 0,
      y: 0,
    });

    expect(handle).toBeDefined();
    expect(handle?.collections).toHaveLength(2);
    expect(handle?.byteLength).toBeGreaterThan(0);

    const firstPoint = new BufferPoint();
    handle?.collections[0]?.collection.get(0, firstPoint);
    const firstMaterial = firstPoint.getMaterial(new BufferPointMaterial()) as BufferPointMaterial;

    expect(handle?.collections[0]?.collection.primitiveCount).toBe(1);
    expect(firstPoint.featureId).toBe(12);
    expect(firstMaterial.size).toBe(14);
    expect(firstMaterial.color.red).toBe(0);
    expect(firstMaterial.color.green).toBe(0);
    expect(firstMaterial.color.blue).toBe(0);
    expect(firstMaterial.color.alpha).toBeCloseTo(0.25, 2);

    const secondPoint = new BufferPoint();
    handle?.collections[1]?.collection.get(0, secondPoint);
    const secondMaterial = secondPoint.getMaterial(new BufferPointMaterial()) as BufferPointMaterial;
    const secondPosition = secondPoint.getPosition(new Cartesian3());

    expect(secondMaterial.size).toBe(10);
    expect(secondMaterial.color).toEqual(Color.RED);
    expect(secondPosition.x).toBeCloseTo(6378137, -1);
    expect(secondPosition.y).toBeCloseTo(0, 5);
    expect(secondPosition.z).toBeCloseTo(0, 5);
  });

  it('returns undefined when the feature tile has no circle batches', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [],
    };

    expect(createCircleTileHandle({
      featureTile: {
        epoch: 1,
        geometryBatches: [],
        key: 'base/0/0/0@1',
      },
      level: 0,
      style,
      x: 0,
      y: 0,
    })).toBeUndefined();
  });
});
