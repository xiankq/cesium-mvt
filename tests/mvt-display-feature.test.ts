import type { MvtPointBucketFeature, MvtPolygonBucketFeature } from '../src/mvt/mvt-types';
import { describe, expect, it } from 'vitest';
import { getClippedDisplayFeature } from '../src/mvt/mesh/mvt-display-feature';
import { createMvtOverzoomTransform } from '../src/mvt/tile/mvt-overzoom';

describe('mvt-display-feature', () => {
  it('assigns a boundary point to only one overscaled child tile', () => {
    const extent = 4096;
    const pointFeature: MvtPointBucketFeature = {
      geometry: [[{ x: 2048, y: 1024 }]],
      geometryType: 'Point',
      properties: {
        name: 'Boundary Label',
      },
    };

    const leftDisplayFeature = getClippedDisplayFeature(
      pointFeature,
      extent,
      createMvtOverzoomTransform(
        { x: 20, y: 40, z: 11 },
        { x: 10, y: 20, z: 10 },
      ),
    );
    const rightDisplayFeature = getClippedDisplayFeature(
      pointFeature,
      extent,
      createMvtOverzoomTransform(
        { x: 21, y: 40, z: 11 },
        { x: 10, y: 20, z: 10 },
      ),
    );

    expect(leftDisplayFeature).toBeUndefined();
    expect(rightDisplayFeature?.geometryType).toBe('Point');
    expect(rightDisplayFeature?.geometry[0]?.[0]).toMatchObject({ x: 0, y: 2048 });
  });

  it('clips overscaled polygons to the current display tile extent', () => {
    const extent = 4096;
    const polygonFeature: MvtPolygonBucketFeature = {
      geometry: [[[
        { x: 0, y: 0 },
        { x: 0, y: 4096 },
        { x: 4096, y: 4096 },
        { x: 4096, y: 0 },
        { x: 0, y: 0 },
      ]]],
      geometryType: 'Polygon',
      properties: {
        name: 'Full Source Polygon',
      },
    };

    const displayFeature = getClippedDisplayFeature(
      polygonFeature,
      extent,
      createMvtOverzoomTransform(
        { x: 20, y: 40, z: 11 },
        { x: 10, y: 20, z: 10 },
      ),
    );

    expect(displayFeature?.geometryType).toBe('Polygon');
    const ring = displayFeature?.geometry[0]?.[0] ?? [];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ring.every(point => point.x >= 0 && point.x <= extent && point.y >= 0 && point.y <= extent)).toBe(true);
  });
});
