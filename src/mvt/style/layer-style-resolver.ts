import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertyContext } from './style-property-evaluator';
import { createStylePropertyEvaluator } from './style-property-evaluator';

/**
 * 图层样式上下文（复用样式属性上下文）
 */
export type LayerStyleContext = StylePropertyContext;

/**
 * Circle 图层样式解析结果
 */
export interface CircleLayerStyle {
  color: string;
  opacity: number;
  radius: number;
}

/**
 * Line 图层样式解析结果
 */
export interface LineLayerStyle {
  color: string;
  opacity: number;
  width: number;
}

/**
 * Fill 图层样式解析结果
 */
export interface FillLayerStyle {
  color: string;
  opacity: number;
  outlineColor?: string;
}

/**
 * 默认 Circle 样式值
 */
const DEFAULT_CIRCLE_COLOR = '#000000';
const DEFAULT_CIRCLE_RADIUS = 5;
const DEFAULT_CIRCLE_OPACITY = 1;

/**
 * 默认 Line 样式值
 */
const DEFAULT_LINE_COLOR = '#000000';
const DEFAULT_LINE_WIDTH = 1;
const DEFAULT_LINE_OPACITY = 1;

/**
 * 默认 Fill 样式值
 */
const DEFAULT_FILL_COLOR = '#000000';
const DEFAULT_FILL_OPACITY = 1;

/**
 * 创建 Circle 图层样式解析器
 */
export function createCircleLayerStyleResolver(
  layer: CircleLayerSpecification,
): (context: LayerStyleContext) => CircleLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createStylePropertyEvaluator<string>(
    paint['circle-color'] ?? DEFAULT_CIRCLE_COLOR,
    DEFAULT_CIRCLE_COLOR,
  );

  const radiusEvaluator = createStylePropertyEvaluator<number>(
    paint['circle-radius'] ?? DEFAULT_CIRCLE_RADIUS,
    DEFAULT_CIRCLE_RADIUS,
  );

  const opacityEvaluator = createStylePropertyEvaluator<number>(
    paint['circle-opacity'] ?? DEFAULT_CIRCLE_OPACITY,
    DEFAULT_CIRCLE_OPACITY,
  );

  return (context: LayerStyleContext): CircleLayerStyle => ({
    color: colorEvaluator(context),
    opacity: opacityEvaluator(context),
    radius: radiusEvaluator(context),
  });
}

/**
 * 创建 Line 图层样式解析器
 */
export function createLineLayerStyleResolver(
  layer: LineLayerSpecification,
): (context: LayerStyleContext) => LineLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createStylePropertyEvaluator<string>(
    paint['line-color'] ?? DEFAULT_LINE_COLOR,
    DEFAULT_LINE_COLOR,
  );

  const widthEvaluator = createStylePropertyEvaluator<number>(
    paint['line-width'] ?? DEFAULT_LINE_WIDTH,
    DEFAULT_LINE_WIDTH,
  );

  const opacityEvaluator = createStylePropertyEvaluator<number>(
    paint['line-opacity'] ?? DEFAULT_LINE_OPACITY,
    DEFAULT_LINE_OPACITY,
  );

  return (context: LayerStyleContext): LineLayerStyle => ({
    color: colorEvaluator(context),
    opacity: opacityEvaluator(context),
    width: widthEvaluator(context),
  });
}

/**
 * 创建 Fill 图层样式解析器
 */
export function createFillLayerStyleResolver(
  layer: FillLayerSpecification,
): (context: LayerStyleContext) => FillLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createStylePropertyEvaluator<string>(
    paint['fill-color'] ?? DEFAULT_FILL_COLOR,
    DEFAULT_FILL_COLOR,
  );

  const opacityEvaluator = createStylePropertyEvaluator<number>(
    paint['fill-opacity'] ?? DEFAULT_FILL_OPACITY,
    DEFAULT_FILL_OPACITY,
  );

  const outlineColorEvaluator = paint['fill-outline-color']
    ? createStylePropertyEvaluator<string>(
        paint['fill-outline-color'],
        DEFAULT_FILL_COLOR,
      )
    : undefined;

  return (context: LayerStyleContext): FillLayerStyle => ({
    color: colorEvaluator(context),
    opacity: opacityEvaluator(context),
    outlineColor: outlineColorEvaluator?.(context),
  });
}
