import type { MvtStyleSpecification } from '../src/mvt/mvt-types';
import { BufferPolylineMaterial, Color } from '@cesium/engine';
import Point from '@mapbox/point-geometry';
import { describe, expect, it } from 'vitest';
import { createFeatureMaterial } from '../src/mvt/render/mvt-style-material';
import {
  resolveCircleStyleRule,
  resolveFillStyleRule,
  resolveLineStyleRule,
} from '../src/mvt/render/mvt-style-rule';
import { MvtStyleSet } from '../src/mvt/style/mvt-style-set';

function createRuleTestStyleSet(): MvtStyleSet {
  const specification: MvtStyleSpecification = {
    glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        'id': 'fills',
        'paint': {
          'fill-antialias': true,
          'fill-color': '#ff0000',
          'fill-opacity': 0.5,
          'fill-translate': [2, -4],
        },
        'source': 'test',
        'source-layer': 'building',
        'type': 'fill',
      },
      {
        'id': 'lines',
        'layout': {
          'line-cap': 'butt',
          'line-join': 'bevel',
        },
        'paint': {
          'line-color': '#00ff00',
          'line-dasharray': [2, 1],
          'line-gap-width': 6,
          'line-offset': 3,
          'line-translate': [1, 2],
          'line-width': 2,
        },
        'source': 'test',
        'source-layer': 'road',
        'type': 'line',
      },
      {
        'id': 'circles',
        'paint': {
          'circle-color': '#0000ff',
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-translate': [-3, 5],
        },
        'source': 'test',
        'source-layer': 'poi',
        'type': 'circle',
      },
    ],
    sources: {
      test: {
        tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        type: 'vector',
      },
    },
    sprite: 'https://example.com/sprite',
    version: 8,
  };

  return MvtStyleSet.fromSpecification(specification, { source: 'test' });
}

describe('mvt-style-rule', () => {
  it('resolves generic fill, line and circle rules instead of bright-specific shortcuts', () => {
    const styleSet = createRuleTestStyleSet();
    const fillLayer = styleSet.getCompiledLayer('fills');
    const lineLayer = styleSet.getCompiledLayer('lines');
    const circleLayer = styleSet.getCompiledLayer('circles');

    expect(fillLayer).toBeDefined();
    expect(lineLayer).toBeDefined();
    expect(circleLayer).toBeDefined();

    const polygonFeature = {
      geometry: [[[new Point(0, 0), new Point(0, 8), new Point(8, 8), new Point(8, 0)]]],
      geometryType: 'Polygon' as const,
      properties: {},
    };
    const lineFeature = {
      geometry: [[new Point(0, 0), new Point(8, 8)]],
      geometryType: 'LineString' as const,
      properties: {},
    };
    const pointFeature = {
      geometry: [[new Point(4, 4)]],
      geometryType: 'Point' as const,
      properties: {},
    };

    const fillRule = resolveFillStyleRule(styleSet, fillLayer!, 12, polygonFeature);
    const lineRule = resolveLineStyleRule(styleSet, lineLayer!, 12, lineFeature);
    const circleRule = resolveCircleStyleRule(styleSet, circleLayer!, 12, pointFeature);

    expect(fillRule.translate).toEqual([2, -4]);
    expect(fillRule.fillColor.alpha).toBeCloseTo(0.5);
    expect(lineRule.dashArray).toEqual([2, 1]);
    expect(lineRule.gapWidth).toBe(6);
    expect(lineRule.offset).toBe(3);
    expect(lineRule.translate).toEqual([1, 2]);
    expect(circleRule.translate).toEqual([-3, 5]);
    expect(circleRule.size).toBe(8);
  });

  it('approximates line-gap-width with Cesium polyline outline materials', () => {
    const styleSet = createRuleTestStyleSet();
    const lineLayer = styleSet.getCompiledLayer('lines');

    const material = createFeatureMaterial(styleSet, lineLayer!, 12, {
      geometry: [[new Point(0, 0), new Point(8, 8)]],
      geometryType: 'LineString',
      properties: {},
    });

    expect(material).toBeInstanceOf(BufferPolylineMaterial);
    const polylineMaterial = material as BufferPolylineMaterial;
    expect(polylineMaterial.width).toBe(6);
    expect(polylineMaterial.outlineWidth).toBe(2);
    expect(polylineMaterial.color).toEqual(Color.TRANSPARENT);
    expect(polylineMaterial.outlineColor.green).toBeGreaterThan(0.9);
  });
});
