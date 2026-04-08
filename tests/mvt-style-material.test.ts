import { BufferPolygonMaterial, BufferPolylineMaterial } from '@cesium/engine';
import Point from '@mapbox/point-geometry';
import { describe, expect, it } from 'vitest';
import { createFeatureMaterial } from '../src/mvt/render/mvt-style-material';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

describe('mvt-style-material', () => {
  it('evaluates zoom expressions from openfreemap bright into Cesium materials', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const buildingLayer = styleSet.getCompiledLayer('building');
    const waterwayLayer = styleSet.getCompiledLayer('waterway-river');

    expect(buildingLayer).toBeDefined();
    expect(waterwayLayer).toBeDefined();

    const materialCache = new Map();
    const fillMaterial = createFeatureMaterial(styleSet, buildingLayer!, 15.75, {
      geometry: [[[new Point(0, 0), new Point(0, 8), new Point(8, 8), new Point(8, 0)]]],
      geometryType: 'Polygon',
      properties: {},
    }, materialCache);
    const fillMaterialAgain = createFeatureMaterial(styleSet, buildingLayer!, 15.75, {
      geometry: [[[new Point(0, 0), new Point(0, 8), new Point(8, 8), new Point(8, 0)]]],
      geometryType: 'Polygon',
      properties: {},
    }, materialCache);
    const lineMaterial = createFeatureMaterial(styleSet, waterwayLayer!, 14, {
      geometry: [[new Point(0, 0), new Point(8, 8)]],
      geometryType: 'LineString',
      properties: {
        brunnel: 'none',
        class: 'river',
        intermittent: 0,
      },
    }, materialCache);

    expect(fillMaterial).toBeInstanceOf(BufferPolygonMaterial);
    expect(lineMaterial).toBeInstanceOf(BufferPolylineMaterial);
    expect(fillMaterialAgain).toBe(fillMaterial);

    const polygonMaterial = fillMaterial as BufferPolygonMaterial;
    const polylineMaterial = lineMaterial as BufferPolylineMaterial;

    expect(polygonMaterial.color.red).toBeGreaterThan(0.7);
    expect(polygonMaterial.color.green).toBeGreaterThan(0.7);
    expect(polylineMaterial.color.blue).toBeGreaterThan(polylineMaterial.color.red);
    expect(polylineMaterial.width).toBeGreaterThan(1);
  }, 15000);
});
