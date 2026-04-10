import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import Point from '@mapbox/point-geometry';
import {
  BufferPolygon,
  BufferPolygonMaterial,
  Cartesian3,
} from 'cesium';
import { describe, expect, it } from 'vitest';
import { createFillTileHandle } from '@/mvt/render/backend/fill-backend';

describe('fill-backend', () => {
  it('creates one buffer collection per fill layer and triangulates polygon geometry', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        land: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        },
      },
      layers: [
        {
          id: 'land-shadow',
          type: 'fill',
          source: 'land',
          paint: {
            'fill-color': '#000000',
            'fill-opacity': 0.2,
            'fill-outline-color': '#333333',
          },
        },
        {
          id: 'land-fill',
          type: 'fill',
          source: 'land',
          paint: {
            'fill-color': '#00ff00',
            'fill-opacity': 0.6,
          },
        },
      ],
    };

    const handle = createFillTileHandle({
      featureTile: {
        epoch: 1,
        geometryBatches: [
          {
            backend: 'fill',
            extent: 4096,
            familyId: 'land/_geojson/fill/0',
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
                properties: {
                  class: 'park',
                },
                type: 'polygon',
              },
            ],
            layerIds: ['land-shadow', 'land-fill'],
            order: 0,
            sourceId: 'land',
            sourceLayer: '_geojson',
            type: 'fill',
          },
        ],
        key: 'land/0/0/0@1',
      },
      level: 0,
      style,
      x: 0,
      y: 0,
    });

    expect(handle).toBeDefined();
    expect(handle?.collections).toHaveLength(2);
    expect(handle?.byteLength).toBeGreaterThan(0);

    const firstPolygon = new BufferPolygon();
    handle?.collections[0]?.collection.get(0, firstPolygon);
    const firstMaterial = firstPolygon.getMaterial(new BufferPolygonMaterial()) as BufferPolygonMaterial;
    const firstPositions = firstPolygon.getPositions(new Float64Array(12)) as unknown as number[];
    const firstTriangles = firstPolygon.getTriangles(new Uint32Array(6)) as Uint32Array;
    const firstVertex = Cartesian3.fromArray(firstPositions, 0, new Cartesian3());

    expect(handle?.collections[0]?.collection.primitiveCount).toBe(1);
    expect(firstPolygon.featureId).toBe(3);
    expect(firstPolygon.vertexCount).toBe(4);
    expect(firstPolygon.holeCount).toBe(0);
    expect(firstPolygon.triangleCount).toBe(2);
    expect(firstMaterial.color.alpha).toBeCloseTo(0.2, 2);
    expect(firstMaterial.outlineWidth).toBe(1);
    expect(firstTriangles).toHaveLength(6);
    expect(Cartesian3.magnitude(firstVertex)).toBeGreaterThan(6_300_000);
    expect(Cartesian3.magnitude(firstVertex)).toBeLessThan(6_400_000);
    expect(firstVertex.z).toBeGreaterThan(0);

    const secondPolygon = new BufferPolygon();
    handle?.collections[1]?.collection.get(0, secondPolygon);
    const secondMaterial = secondPolygon.getMaterial(new BufferPolygonMaterial()) as BufferPolygonMaterial;

    expect(secondMaterial.color.green).toBe(1);
    expect(secondMaterial.color.alpha).toBeCloseTo(0.6, 2);
    expect(secondMaterial.outlineWidth).toBe(0);
  });

  it('returns undefined when the feature tile has no fill batches', () => {
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

    expect(createFillTileHandle({
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
