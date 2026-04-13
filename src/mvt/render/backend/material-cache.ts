import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertyContext } from '../../style/style-property-evaluator';
import {
  BufferPointMaterial,
  BufferPolygonMaterial,
  BufferPolylineMaterial,
  Color,
} from 'cesium';
import {
  createCircleLayerStyleResolver,
  createFillLayerStyleResolver,
  createLineLayerStyleResolver,
} from '../../style/layer-style-resolver';

const DEFAULT_CIRCLE_COLOR = Color.BLACK;
const DEFAULT_FILL_COLOR = Color.BLACK;
const DEFAULT_LINE_COLOR = Color.BLACK;

type LayerStyleResolver<TResolved> = (context: StylePropertyContext) => TResolved;
type CircleLayerStyleResolver = ReturnType<typeof createCircleLayerStyleResolver>;
type LineLayerStyleResolver = ReturnType<typeof createLineLayerStyleResolver>;
type FillLayerStyleResolver = ReturnType<typeof createFillLayerStyleResolver>;

const EMPTY_STYLE_CONTEXT: StylePropertyContext = {
  properties: {},
  zoom: 0,
};

const circleResolvers = new WeakMap<
  StyleSpecification,
  WeakMap<CircleLayerSpecification, CircleLayerStyleResolver>
>();
const circleMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<CircleLayerSpecification, Map<string, BufferPointMaterial>>
>();

const lineResolvers = new WeakMap<
  StyleSpecification,
  WeakMap<LineLayerSpecification, LineLayerStyleResolver>
>();
const lineMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<LineLayerSpecification, Map<string, BufferPolylineMaterial>>
>();

const fillResolvers = new WeakMap<
  StyleSpecification,
  WeakMap<FillLayerSpecification, FillLayerStyleResolver>
>();
const fillMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<FillLayerSpecification, Map<string, BufferPolygonMaterial>>
>();

export function getCircleMaterial(
  style: StyleSpecification,
  layer: CircleLayerSpecification,
  context: StylePropertyContext = EMPTY_STYLE_CONTEXT,
): BufferPointMaterial {
  return getResolvedMaterial(
    circleResolvers,
    circleMaterials,
    style,
    layer,
    context,
    () => createCircleLayerStyleResolver(layer),
    (resolvedStyle) => {
      const color = toColor(resolvedStyle.color, resolvedStyle.opacity, DEFAULT_CIRCLE_COLOR);
      return new BufferPointMaterial({
        color,
        // circle-radius 表示半径，而 BufferPoint 的 size 语义是完整点精灵尺寸。
        size: resolvedStyle.radius * 2,
      });
    },
  );
}

export function getLineMaterial(
  style: StyleSpecification,
  layer: LineLayerSpecification,
  context: StylePropertyContext = EMPTY_STYLE_CONTEXT,
): BufferPolylineMaterial {
  return getResolvedMaterial(
    lineResolvers,
    lineMaterials,
    style,
    layer,
    context,
    () => createLineLayerStyleResolver(layer),
    resolvedStyle => new BufferPolylineMaterial({
      color: toColor(resolvedStyle.color, resolvedStyle.opacity, DEFAULT_LINE_COLOR),
      width: resolvedStyle.width,
    }),
  );
}

export function getFillMaterial(
  style: StyleSpecification,
  layer: FillLayerSpecification,
  context: StylePropertyContext = EMPTY_STYLE_CONTEXT,
): BufferPolygonMaterial {
  return getResolvedMaterial(
    fillResolvers,
    fillMaterials,
    style,
    layer,
    context,
    () => createFillLayerStyleResolver(layer),
    (resolvedStyle) => {
      const color = toColor(resolvedStyle.color, resolvedStyle.opacity, DEFAULT_FILL_COLOR);
      const outlineColor = resolvedStyle.outlineColor
        ? toColor(resolvedStyle.outlineColor, resolvedStyle.opacity, DEFAULT_FILL_COLOR)
        : Color.clone(DEFAULT_FILL_COLOR);

      return new BufferPolygonMaterial({
        color,
        outlineColor,
        outlineWidth: resolvedStyle.outlineColor ? 1 : 0,
      });
    },
  );
}

function getResolvedMaterial<TLayer extends object, TResolved, TMaterial>(
  resolverCacheByStyle: WeakMap<StyleSpecification, WeakMap<TLayer, LayerStyleResolver<TResolved>>>,
  materialCacheByStyle: WeakMap<StyleSpecification, WeakMap<TLayer, Map<string, TMaterial>>>,
  style: StyleSpecification,
  layer: TLayer,
  context: StylePropertyContext,
  createResolver: () => LayerStyleResolver<TResolved>,
  createMaterial: (resolved: TResolved) => TMaterial,
): TMaterial {
  const resolver = getOrCreateResolver(
    resolverCacheByStyle,
    style,
    layer,
    createResolver,
  );
  const resolved = resolver(context);
  const materialKey = JSON.stringify(resolved);

  const cacheByLayer = getOrCreateLayerMaterialCache(
    materialCacheByStyle,
    style,
    layer,
  );

  const cachedMaterial = cacheByLayer.get(materialKey);
  if (cachedMaterial) {
    return cachedMaterial;
  }

  const material = createMaterial(resolved);
  cacheByLayer.set(materialKey, material);
  return material;
}

function getOrCreateResolver<TLayer extends object, TResolved>(
  resolverCacheByStyle: WeakMap<StyleSpecification, WeakMap<TLayer, LayerStyleResolver<TResolved>>>,
  style: StyleSpecification,
  layer: TLayer,
  createResolver: () => LayerStyleResolver<TResolved>,
): LayerStyleResolver<TResolved> {
  let cacheByLayer = resolverCacheByStyle.get(style);
  if (!cacheByLayer) {
    cacheByLayer = new WeakMap<TLayer, LayerStyleResolver<TResolved>>();
    resolverCacheByStyle.set(style, cacheByLayer);
  }

  const cachedResolver = cacheByLayer.get(layer);
  if (cachedResolver) {
    return cachedResolver;
  }

  const resolver = createResolver();
  cacheByLayer.set(layer, resolver);
  return resolver;
}

function getOrCreateLayerMaterialCache<TLayer extends object, TMaterial>(
  materialCacheByStyle: WeakMap<StyleSpecification, WeakMap<TLayer, Map<string, TMaterial>>>,
  style: StyleSpecification,
  layer: TLayer,
): Map<string, TMaterial> {
  let cacheByLayer = materialCacheByStyle.get(style);
  if (!cacheByLayer) {
    cacheByLayer = new WeakMap<TLayer, Map<string, TMaterial>>();
    materialCacheByStyle.set(style, cacheByLayer);
  }

  let cache = cacheByLayer.get(layer);
  if (!cache) {
    cache = new Map<string, TMaterial>();
    cacheByLayer.set(layer, cache);
  }

  return cache;
}

function toColor(
  color: string,
  opacity: number,
  fallback: Color,
): Color {
  const resolvedColor = Color.fromCssColorString(color) ?? Color.clone(fallback);
  resolvedColor.alpha *= clampOpacity(opacity);
  return resolvedColor;
}

function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}
