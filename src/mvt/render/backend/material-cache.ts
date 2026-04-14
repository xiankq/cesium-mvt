import type {
  CircleLayerSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertyContext } from '../../style/style-property-evaluator';
import {
  BufferPointMaterial,
  BufferPolygonMaterial,
  BufferPolylineMaterial,
  Cartesian2,
  Color,
  Material,
} from 'cesium';
import {
  createCircleLayerStyleResolver,
  createFillExtrusionLayerStyleResolver,
  createFillLayerStyleResolver,
  createLineLayerStyleResolver,
} from '../../style/layer-style-resolver';
import { resolveStyleImage } from '../../style/sprite-atlas';

const DEFAULT_CIRCLE_COLOR = Color.BLACK;
const DEFAULT_FILL_COLOR = Color.BLACK;
const DEFAULT_LINE_COLOR = Color.BLACK;
const POLYLINE_IMAGE_PATTERN_TYPE = 'PolylineImagePattern';
const POLYLINE_IMAGE_PATTERN_SOURCE = [
  'uniform sampler2D image;',
  'uniform vec2 imageSize;',
  'uniform vec4 color;',
  'in float v_polylineAngle;',
  '',
  'mat2 rotate(float rad) {',
  '    float c = cos(rad);',
  '    float s = sin(rad);',
  '    return mat2(',
  '        c, s,',
  '        -s, c',
  '    );',
  '}',
  '',
  'czm_material czm_getMaterial(czm_materialInput materialInput)',
  '{',
  '    czm_material material = czm_getDefaultMaterial(materialInput);',
  '    vec2 patternSize = max(imageSize * czm_pixelRatio, vec2(1.0));',
  '    vec2 pos = rotate(v_polylineAngle) * gl_FragCoord.xy;',
  '    vec2 st = fract(pos / patternSize);',
  '    vec4 fragColor = texture(image, st) * color;',
  '    if (fragColor.a < 0.005) {',
  '        discard;',
  '    }',
  '',
  '    fragColor = czm_gammaCorrect(fragColor);',
  '    material.diffuse = fragColor.rgb;',
  '    material.alpha = fragColor.a;',
  '    return material;',
  '}',
].join('\n');

type LayerStyleResolver<TResolved> = (context: StylePropertyContext) => TResolved;
type CircleLayerStyleResolver = ReturnType<typeof createCircleLayerStyleResolver>;
type LineLayerStyleResolver = ReturnType<typeof createLineLayerStyleResolver>;
type FillLayerStyleResolver = ReturnType<typeof createFillLayerStyleResolver>;
type FillExtrusionLayerStyleResolver = ReturnType<typeof createFillExtrusionLayerStyleResolver>;

const EMPTY_STYLE_CONTEXT: StylePropertyContext = {
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
const lineCollectionResolvers = new WeakMap<
  StyleSpecification,
  WeakMap<LineLayerSpecification, LineLayerStyleResolver>
>();
const lineCollectionMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<LineLayerSpecification, Map<string, Material>>
>();

const fillResolvers = new WeakMap<
  StyleSpecification,
  WeakMap<FillLayerSpecification, FillLayerStyleResolver>
>();
const fillMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<FillLayerSpecification, Map<string, BufferPolygonMaterial>>
>();
const fillPatternMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<FillLayerSpecification, Map<string, Material>>
>();
const fillExtrusionResolvers = new WeakMap<
  StyleSpecification,
  WeakMap<FillExtrusionLayerSpecification, FillExtrusionLayerStyleResolver>
>();
const fillExtrusionMaterials = new WeakMap<
  StyleSpecification,
  WeakMap<FillExtrusionLayerSpecification, Map<string, Material>>
>();

const materialCache = Material as typeof Material & {
  _materialCache: {
    addMaterial: (type: string, materialTemplate: unknown) => void;
    getMaterial: (type: string) => unknown;
  };
};

if (!materialCache._materialCache.getMaterial(POLYLINE_IMAGE_PATTERN_TYPE)) {
  materialCache._materialCache.addMaterial(POLYLINE_IMAGE_PATTERN_TYPE, {
    fabric: {
      source: POLYLINE_IMAGE_PATTERN_SOURCE,
      type: POLYLINE_IMAGE_PATTERN_TYPE,
      uniforms: {
        color: new Color(1.0, 1.0, 1.0, 1.0),
        image: Material.DefaultImageId,
        imageSize: new Cartesian2(1.0, 1.0),
      },
    },
    translucent: (material: { uniforms: { color: Color } }) =>
      material.uniforms.color.alpha < 1.0,
  });
}

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

export function getLineCollectionMaterial(
  style: StyleSpecification,
  layer: LineLayerSpecification,
  context: StylePropertyContext = EMPTY_STYLE_CONTEXT,
): Material {
  return getResolvedMaterial(
    lineCollectionResolvers,
    lineCollectionMaterials,
    style,
    layer,
    context,
    () => createLineLayerStyleResolver(layer),
    (resolvedStyle) => {
      const color = toColor(resolvedStyle.color, resolvedStyle.opacity, DEFAULT_LINE_COLOR);

      const resolvedImage = resolveStyleImage(style, resolvedStyle.pattern);
      if (resolvedImage) {
        return Material.fromType(POLYLINE_IMAGE_PATTERN_TYPE, {
          color,
          image: resolvedImage.image,
          imageSize: new Cartesian2(
            Math.max(1, resolvedImage.width),
            Math.max(1, resolvedImage.height),
          ),
        });
      }

      if (resolvedStyle.dashArray && resolvedStyle.dashArray.length > 0) {
        const dashLength = Math.max(
          resolvedStyle.width * resolvedStyle.dashArray.reduce(
            (total, value) => total + Math.max(0, value),
            0,
          ),
          1,
        );

        return Material.fromType(Material.PolylineDashType, {
          color,
          dashLength,
          dashPattern: encodeLineDashPattern(resolvedStyle.dashArray),
          gapColor: Color.clone(Color.TRANSPARENT),
        });
      }

      return Material.fromType(Material.ColorType, {
        color,
      });
    },
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

export function getFillPatternMaterial(
  style: StyleSpecification,
  layer: FillLayerSpecification,
  context: StylePropertyContext = EMPTY_STYLE_CONTEXT,
  tileWidth: number = 256,
): Material {
  return getResolvedMaterial(
    fillResolvers,
    fillPatternMaterials,
    style,
    layer,
    context,
    () => createFillLayerStyleResolver(layer),
    (resolvedStyle) => {
      const color = toColor(resolvedStyle.color, resolvedStyle.opacity, DEFAULT_FILL_COLOR);
      const resolvedImage = resolveStyleImage(style, resolvedStyle.pattern);

      if (!resolvedImage) {
        return Material.fromType(Material.ColorType, {
          color,
        });
      }

      const repeatX = tileWidth / Math.max(1, resolvedImage.width);
      const repeatY = tileWidth / Math.max(1, resolvedImage.height);

      return Material.fromType(Material.ImageType, {
        color,
        image: resolvedImage.image,
        repeat: new Cartesian2(repeatX, repeatY),
      });
    },
    resolvedStyle => JSON.stringify({
      pattern: resolvedStyle.pattern,
      color: resolvedStyle.color,
      opacity: resolvedStyle.opacity,
      tileWidth,
    }),
  );
}

export function getFillExtrusionMaterial(
  style: StyleSpecification,
  layer: FillExtrusionLayerSpecification,
  context: StylePropertyContext = EMPTY_STYLE_CONTEXT,
  tileWidth = 256,
): Material {
  return getResolvedMaterial(
    fillExtrusionResolvers,
    fillExtrusionMaterials,
    style,
    layer,
    context,
    () => createFillExtrusionLayerStyleResolver(layer),
    (resolvedStyle) => {
      const color = toColor(resolvedStyle.color, resolvedStyle.opacity, DEFAULT_FILL_COLOR);
      const resolvedImage = resolveStyleImage(style, resolvedStyle.pattern);

      if (!resolvedImage) {
        return Material.fromType(Material.ColorType, {
          color,
        });
      }

      const repeatX = tileWidth / Math.max(1, resolvedImage.width);
      const repeatY = tileWidth / Math.max(1, resolvedImage.height);

      return Material.fromType(Material.ImageType, {
        color,
        image: resolvedImage.image,
        repeat: new Cartesian2(repeatX, repeatY),
      });
    },
    resolvedStyle => JSON.stringify({
      color: resolvedStyle.color,
      opacity: resolvedStyle.opacity,
      pattern: resolvedStyle.pattern,
      tileWidth,
    }),
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
  createCacheKey: (resolved: TResolved) => string = resolved => JSON.stringify(resolved),
): TMaterial {
  const resolver = getOrCreateResolver(
    resolverCacheByStyle,
    style,
    layer,
    createResolver,
  );
  const resolved = resolver(context);
  const materialKey = createCacheKey(resolved);

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

function encodeLineDashPattern(dashArray: readonly number[]): number {
  const total = dashArray.reduce(
    (sum, value) => sum + Math.max(0, value),
    0,
  );

  if (total <= 0) {
    return 0;
  }

  let mask = 0;
  const bitCount = 16;

  for (let bit = 0; bit < bitCount; bit += 1) {
    const sample = ((bit + 0.5) / bitCount) * total;
    let cursor = 0;

    for (let index = 0; index < dashArray.length; index += 1) {
      const length = Math.max(0, dashArray[index]!);
      cursor += length;

      if (sample <= cursor || index === dashArray.length - 1) {
        if (index % 2 === 0 && length > 0) {
          mask |= 1 << bit;
        }
        break;
      }
    }
  }

  return mask;
}
