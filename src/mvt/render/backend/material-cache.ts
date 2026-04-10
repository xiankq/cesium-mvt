import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import {
  BufferPointMaterial,
  BufferPolygonMaterial,
  BufferPolylineMaterial,
  Color,
} from 'cesium';

const DEFAULT_CIRCLE_COLOR = Color.BLACK;
const DEFAULT_CIRCLE_RADIUS = 5;
const DEFAULT_FILL_COLOR = Color.BLACK;
const DEFAULT_LINE_COLOR = Color.BLACK;
const DEFAULT_LINE_WIDTH = 1;

const circleMaterialCache = new WeakMap<
  StyleSpecification,
  WeakMap<CircleLayerSpecification, BufferPointMaterial>
>();
const lineMaterialCache = new WeakMap<
  StyleSpecification,
  WeakMap<LineLayerSpecification, BufferPolylineMaterial>
>();
const fillMaterialCache = new WeakMap<
  StyleSpecification,
  WeakMap<FillLayerSpecification, BufferPolygonMaterial>
>();

export function getCircleMaterial(
  style: StyleSpecification,
  layer: CircleLayerSpecification,
): BufferPointMaterial {
  return getOrCreateStyleScopedMaterial(
    circleMaterialCache,
    style,
    layer,
    () => {
      const color = resolveCircleColor(layer);
      const radius = resolveCircleRadius(layer);
      return new BufferPointMaterial({
        color,
        // circle-radius 表示半径，而 BufferPoint 的 size 语义是完整点精灵尺寸。
        size: radius * 2,
      });
    },
  );
}

export function getLineMaterial(
  style: StyleSpecification,
  layer: LineLayerSpecification,
): BufferPolylineMaterial {
  return getOrCreateStyleScopedMaterial(
    lineMaterialCache,
    style,
    layer,
    () => new BufferPolylineMaterial({
      color: resolveLineColor(layer),
      width: resolveLineWidth(layer),
    }),
  );
}

export function getFillMaterial(
  style: StyleSpecification,
  layer: FillLayerSpecification,
): BufferPolygonMaterial {
  return getOrCreateStyleScopedMaterial(
    fillMaterialCache,
    style,
    layer,
    () => {
      const paint = layer.paint ?? {};
      const fillOpacity = resolveNumberPaintValue(paint['fill-opacity'], 1);
      const hasOutlineColor = typeof paint['fill-outline-color'] === 'string';

      return new BufferPolygonMaterial({
        color: applyOpacity(
          resolveColorPaintValue(
            paint['fill-color'],
            DEFAULT_FILL_COLOR,
          ),
          fillOpacity,
        ),
        outlineColor: applyOpacity(
          resolveColorPaintValue(
            paint['fill-outline-color'],
            DEFAULT_FILL_COLOR,
          ),
          fillOpacity,
        ),
        outlineWidth: hasOutlineColor ? 1 : 0,
      });
    },
  );
}

function getOrCreateStyleScopedMaterial<TLayer extends object, TMaterial>(
  cacheByStyle: WeakMap<StyleSpecification, WeakMap<TLayer, TMaterial>>,
  style: StyleSpecification,
  layer: TLayer,
  factory: () => TMaterial,
): TMaterial {
  let cacheByLayer = cacheByStyle.get(style);
  if (!cacheByLayer) {
    cacheByLayer = new WeakMap<TLayer, TMaterial>();
    cacheByStyle.set(style, cacheByLayer);
  }

  const cachedMaterial = cacheByLayer.get(layer);
  if (cachedMaterial) {
    return cachedMaterial;
  }

  const material = factory();
  cacheByLayer.set(layer, material);
  return material;
}

function resolveCircleColor(layer: CircleLayerSpecification): Color {
  const paint = layer.paint;
  if (!paint || !('circle-color' in paint)) {
    return DEFAULT_CIRCLE_COLOR;
  }

  const colorSpec = paint['circle-color'];
  if (typeof colorSpec === 'string') {
    return Color.fromCssColorString(colorSpec) ?? DEFAULT_CIRCLE_COLOR;
  }

  return DEFAULT_CIRCLE_COLOR;
}

function resolveCircleRadius(layer: CircleLayerSpecification): number {
  const paint = layer.paint;
  if (!paint || !('circle-radius' in paint)) {
    return DEFAULT_CIRCLE_RADIUS;
  }

  const radiusSpec = paint['circle-radius'];
  if (typeof radiusSpec === 'number') {
    return radiusSpec;
  }

  return DEFAULT_CIRCLE_RADIUS;
}

function resolveLineColor(layer: LineLayerSpecification): Color {
  const paint = layer.paint;
  if (!paint || !('line-color' in paint)) {
    return DEFAULT_LINE_COLOR;
  }

  const colorSpec = paint['line-color'];
  if (typeof colorSpec === 'string') {
    return Color.fromCssColorString(colorSpec) ?? DEFAULT_LINE_COLOR;
  }

  return DEFAULT_LINE_COLOR;
}

function resolveLineWidth(layer: LineLayerSpecification): number {
  const paint = layer.paint;
  if (!paint || !('line-width' in paint)) {
    return DEFAULT_LINE_WIDTH;
  }

  const widthSpec = paint['line-width'];
  if (typeof widthSpec === 'number') {
    return widthSpec;
  }

  return DEFAULT_LINE_WIDTH;
}

function resolveColorPaintValue(value: unknown, fallback: Color) {
  if (typeof value !== 'string') {
    return Color.clone(fallback);
  }

  return Color.fromCssColorString(value) ?? Color.clone(fallback);
}

function resolveNumberPaintValue(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : fallback;
}

function applyOpacity(color: Color, opacity: number) {
  const resolvedColor = Color.clone(color);
  resolvedColor.alpha *= clampOpacity(opacity);
  return resolvedColor;
}

function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}
