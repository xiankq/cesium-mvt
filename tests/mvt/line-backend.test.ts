import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import Point from '@mapbox/point-geometry';
import {
  BufferPolyline,
  BufferPolylineMaterial,
} from 'cesium';
import { describe, expect, it } from 'vitest';
import { createLineTileHandle } from '@/mvt/render/backend/line-backend';

describe('line-backend', () => {
  it('creates one buffer collection per line layer and projects line vertices onto the globe', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        road: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'road-casing',
          type: 'line',
          source: 'road',
          paint: {
            'line-color': '#000000',
            'line-opacity': 0.25,
            'line-width': 6,
          },
        },
        {
          id: 'road-fill',
          type: 'line',
          source: 'road',
          paint: {
            'line-color': '#ff0000',
            'line-width': 4,
          },
        },
      ],
    };

    const handle = createLineTileHandle({
      featureTile: {
        epoch: 1,
        geometryBatches: [
          {
            backend: 'line',
            extent: 4096,
            familyId: 'road/_geojson/line/0',
            featureCount: 1,
            features: [
              {
                geometry: [[new Point(1024, 2048), new Point(3072, 2048)]],
                id: 7,
                properties: {
                  class: 'primary',
                },
                type: 'line',
              },
            ],
            layerIds: ['road-casing', 'road-fill'],
            order: 0,
            sourceId: 'road',
            sourceLayer: '_geojson',
            type: 'line',
          },
        ],
        key: 'road/0/0/0@1',
      },
      level: 0,
      style,
      x: 0,
      y: 0,
    });

    expect(handle).toBeDefined();
    expect(handle?.collections).toHaveLength(2);
    expect(handle?.byteLength).toBeGreaterThan(0);

    const firstLine = new BufferPolyline();
    handle?.collections[0]?.collection.get(0, firstLine);
    const firstMaterial = firstLine.getMaterial(new BufferPolylineMaterial()) as BufferPolylineMaterial;
    const firstPositions = firstLine.getPositions(new Float64Array(6)) as Float64Array;

    expect(handle?.collections[0]?.collection.primitiveCount).toBe(1);
    expect(firstLine.featureId).toBe(7);
    expect(firstMaterial.width).toBe(6);
    expect(firstMaterial.color.alpha).toBeCloseTo(0.25, 2);
    expect(firstPositions[0]).toBeCloseTo(0, 5);
    expect(firstPositions[1]).toBeCloseTo(-6378137, -1);
    expect(firstPositions[2]).toBeCloseTo(0, 5);
    expect(firstPositions[3]).toBeCloseTo(0, 5);
    expect(firstPositions[4]).toBeCloseTo(6378137, -1);
    expect(firstPositions[5]).toBeCloseTo(0, 5);

    const secondLine = new BufferPolyline();
    handle?.collections[1]?.collection.get(0, secondLine);
    const secondMaterial = secondLine.getMaterial(new BufferPolylineMaterial()) as BufferPolylineMaterial;

    expect(secondMaterial.width).toBe(4);
    expect(secondMaterial.color.red).toBe(1);
    expect(secondMaterial.color.green).toBe(0);
    expect(secondMaterial.color.blue).toBe(0);
  });

  it('returns undefined when the feature tile has no line batches', () => {
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

    expect(createLineTileHandle({
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
