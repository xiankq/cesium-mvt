import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(async () => {
  const { resetMaterialCacheMetrics } = await import('@/mvt/render/backend/material-cache');
  resetMaterialCacheMetrics();
});

describe('material-cache', () => {
  it('reuses circle materials for the same style layer', async () => {
    const { getCircleMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyle();
    const layer = style.layers[0] as CircleLayerSpecification;

    const firstMaterial = getCircleMaterial(style, layer);
    const secondMaterial = getCircleMaterial(style, layer);

    expect(secondMaterial).toBe(firstMaterial);
  });

  it('reuses line materials for the same style layer', async () => {
    const { getLineMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyle();
    const layer = style.layers[1] as LineLayerSpecification;

    const firstMaterial = getLineMaterial(style, layer);
    const secondMaterial = getLineMaterial(style, layer);

    expect(secondMaterial).toBe(firstMaterial);
  });

  it('reuses fill materials for the same style layer', async () => {
    const { getFillMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyle();
    const layer = style.layers[2] as FillLayerSpecification;

    const firstMaterial = getFillMaterial(style, layer);
    const secondMaterial = getFillMaterial(style, layer);

    expect(secondMaterial).toBe(firstMaterial);
  });

  it('does not share materials across different style objects', async () => {
    const { getCircleMaterial } = await import('@/mvt/render/backend/material-cache');
    const firstStyle = createStyle();
    const secondStyle = createStyle();

    const firstMaterial = getCircleMaterial(
      firstStyle,
      firstStyle.layers[0] as CircleLayerSpecification,
    );
    const secondMaterial = getCircleMaterial(
      secondStyle,
      secondStyle.layers[0] as CircleLayerSpecification,
    );

    expect(secondMaterial).not.toBe(firstMaterial);
  });

  it('falls back to default color when circle-color is an invalid CSS color string', async () => {
    const { getCircleMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyleWithCirclePaint({ 'circle-color': 'not-a-color' });
    const layer = style.layers[0] as CircleLayerSpecification;

    const material = getCircleMaterial(style, layer);

    expect(material).toBeDefined();
    expect(material.color).toBeDefined();
  });

  it('falls back to default color when line-color is an invalid CSS color string', async () => {
    const { getLineMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyleWithLinePaint({ 'line-color': 'not-a-color' });
    const layer = style.layers[0] as LineLayerSpecification;

    const material = getLineMaterial(style, layer);

    expect(material).toBeDefined();
    expect(material.color).toBeDefined();
  });

  it('falls back to default color when fill-color is an invalid CSS color string', async () => {
    const { getFillMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyleWithFillPaint({ 'fill-color': 'not-a-color' });
    const layer = style.layers[0] as FillLayerSpecification;

    const material = getFillMaterial(style, layer);

    expect(material).toBeDefined();
    expect(material.color).toBeDefined();
  });

  it('uses defaults when paint properties are missing entirely', async () => {
    const { getCircleMaterial, getLineMaterial, getFillMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyleWithMinimalLayers();

    const circleLayer = style.layers[0] as CircleLayerSpecification;
    const lineLayer = style.layers[1] as LineLayerSpecification;
    const fillLayer = style.layers[2] as FillLayerSpecification;

    const circleMat = getCircleMaterial(style, circleLayer);
    const lineMat = getLineMaterial(style, lineLayer);
    const fillMat = getFillMaterial(style, fillLayer);

    expect(circleMat.color).toBeDefined();
    expect(circleMat.size).toBe(10);
    expect(lineMat.color).toBeDefined();
    expect(lineMat.width).toBe(1);
    expect(fillMat.color).toBeDefined();
    expect(fillMat.outlineWidth).toBe(0);
  });

  it('clamps fill opacity to valid range', async () => {
    const { getFillMaterial } = await import('@/mvt/render/backend/material-cache');

    const styleBelow = createStyleWithFillPaint({ 'fill-opacity': -0.5 });
    const layerBelow = styleBelow.layers[0] as FillLayerSpecification;
    const matBelow = getFillMaterial(styleBelow, layerBelow);

    const styleAbove = createStyleWithFillPaint({ 'fill-opacity': 2 });
    const layerAbove = styleAbove.layers[0] as FillLayerSpecification;
    const matAbove = getFillMaterial(styleAbove, layerAbove);

    expect(matBelow.color.alpha).toBeGreaterThanOrEqual(0);
    expect(matBelow.color.alpha).toBeLessThanOrEqual(1);
    expect(matAbove.color.alpha).toBeGreaterThanOrEqual(0);
    expect(matAbove.color.alpha).toBeLessThanOrEqual(1);
  });

  it('does not set outlineWidth when fill-outline-color is absent', async () => {
    const { getFillMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyleWithFillPaint({ 'fill-color': '#ff0000' });
    const layer = style.layers[0] as FillLayerSpecification;

    const material = getFillMaterial(style, layer);

    expect(material.outlineWidth).toBe(0);
  });

  it('sets outlineWidth when fill-outline-color is present', async () => {
    const { getFillMaterial } = await import('@/mvt/render/backend/material-cache');
    const style = createStyleWithFillPaint({
      'fill-color': '#ff0000',
      'fill-outline-color': '#00ff00',
    });
    const layer = style.layers[0] as FillLayerSpecification;

    const material = getFillMaterial(style, layer);

    expect(material.outlineWidth).toBe(1);
  });

  it('应该统计材质缓存命中和未命中次数', async () => {
    const { getCircleMaterial, getMaterialCacheMetrics, resetMaterialCacheMetrics } = await import('@/mvt/render/backend/material-cache');
    resetMaterialCacheMetrics();
    const style = createStyle();
    const layer = style.layers[0] as CircleLayerSpecification;

    expect(getMaterialCacheMetrics()).toMatchObject({
      hitCount: 0,
      missCount: 0,
    });

    getCircleMaterial(style, layer);
    getCircleMaterial(style, layer);

    expect(getMaterialCacheMetrics()).toMatchObject({
      hitCount: 1,
      missCount: 1,
    });
  });
});

function createStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'poi',
        'type': 'circle',
        'source': 'source',
        'source-layer': 'layer',
        'paint': {
          'circle-color': '#0088ff',
          'circle-radius': 6,
        },
      },
      {
        'id': 'road',
        'type': 'line',
        'source': 'source',
        'source-layer': 'layer',
        'paint': {
          'line-color': '#00aa55',
          'line-width': 2,
        },
      },
      {
        'id': 'land',
        'type': 'fill',
        'source': 'source',
        'source-layer': 'layer',
        'paint': {
          'fill-color': '#ffaa00',
          'fill-opacity': 0.5,
          'fill-outline-color': '#663300',
        },
      },
    ],
  };
}

function createStyleWithCirclePaint(paint: Record<string, unknown>): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'circle-layer',
        'type': 'circle',
        'source': 'source',
        'source-layer': 'layer',
        paint,
      },
    ],
  };
}

function createStyleWithLinePaint(paint: Record<string, unknown>): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'line-layer',
        'type': 'line',
        'source': 'source',
        'source-layer': 'layer',
        paint,
      },
    ],
  };
}

function createStyleWithFillPaint(paint: Record<string, unknown>): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'fill-layer',
        'type': 'fill',
        'source': 'source',
        'source-layer': 'layer',
        paint,
      },
    ],
  };
}

function createStyleWithMinimalLayers(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'circle-layer',
        'type': 'circle',
        'source': 'source',
        'source-layer': 'layer',
      },
      {
        'id': 'line-layer',
        'type': 'line',
        'source': 'source',
        'source-layer': 'layer',
      },
      {
        'id': 'fill-layer',
        'type': 'fill',
        'source': 'source',
        'source-layer': 'layer',
      },
    ],
  };
}
