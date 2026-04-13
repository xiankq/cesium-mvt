import type { ExpressionContext } from './expression-evaluator';
import { evaluateExpression } from './expression-evaluator';

/**
 * 样式属性求值上下文
 *
 * 扩展表达式上下文，添加样式特定的属性
 */
export interface StylePropertyContext extends ExpressionContext {
  zoom: number;
}

/**
 * Zoom 函数停止点
 */
export interface ZoomStop<T = unknown> {
  value: T;
  zoom: number;
}

/**
 * 属性函数停止点
 */
export interface PropertyStop<T = unknown> {
  value: T;
  zoom?: number;
}

/**
 * Zoom + 属性组合停止点
 */
export interface ZoomPropertyStop<T = unknown> {
  value: T;
  zoom: number;
}

/**
 * Zoom 函数定义
 */
export interface ZoomFunction<T = unknown> {
  base?: number;
  stops: Array<[number, T]>;
}

/**
 * 属性函数定义
 */
export interface PropertyFunction<T = unknown> {
  property: string;
  stops: Array<[unknown, T]>;
  type?: 'categorical' | 'interval' | 'exponential';
  default?: T;
}

/**
 * Identity 函数定义
 */
export interface IdentityFunction<T = unknown> {
  default?: T;
  property: string;
  type: 'identity';
}

/**
 * Zoom + 属性组合函数定义
 */
export interface ZoomPropertyFunction<T = unknown> {
  property: string;
  stops: Array<[ZoomPropertyStop, T]>;
  default?: T;
}

/**
 * 样式属性值类型
 *
 * 可以是：
 * - 静态值
 * - 表达式数组
 * - Zoom 函数
 * - 属性函数
 * - Identity 函数
 * - Zoom + 属性组合函数
 */
export type StylePropertyValue<T = unknown>
  = | T
    | unknown[]
    | ZoomFunction<T>
    | PropertyFunction<T>
    | IdentityFunction<T>
    | ZoomPropertyFunction<T>;

/**
 * 样式属性求值器
 *
 * 将样式属性值求值为具体值
 */
export type StylePropertyEvaluator<T = unknown> = (
  context: StylePropertyContext,
) => T;

/**
 * 判断是否为 Zoom 函数
 */
function isZoomFunction<T>(value: StylePropertyValue<T>): value is ZoomFunction<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'stops' in obj
    && Array.isArray(obj.stops)
    && obj.stops.length > 0
    && Array.isArray(obj.stops[0])
    && obj.stops[0].length === 2
    && typeof obj.stops[0][0] === 'number';
}

/**
 * 判断是否为属性函数
 */
function isPropertyFunction<T>(value: StylePropertyValue<T>): value is PropertyFunction<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'property' in obj
    && typeof obj.property === 'string'
    && 'stops' in obj
    && Array.isArray(obj.stops);
}

/**
 * 判断是否为 Zoom + 属性组合函数
 */
function isZoomPropertyFunction<T>(value: StylePropertyValue<T>): value is ZoomPropertyFunction<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'property' in obj
    && typeof obj.property === 'string'
    && 'stops' in obj
    && Array.isArray(obj.stops)
    && obj.stops.length > 0
    && Array.isArray(obj.stops[0])
    && obj.stops[0].length === 2
    && typeof obj.stops[0][0] === 'object'
    && obj.stops[0][0] !== null
    && 'zoom' in (obj.stops[0][0] as Record<string, unknown>);
}

/**
 * 判断是否为表达式
 */
function isExpression(value: StylePropertyValue): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}

/**
 * 判断是否为 Identity 函数
 */
function isIdentityFunction<T>(value: StylePropertyValue<T>): value is IdentityFunction<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'type' in obj
    && obj.type === 'identity'
    && 'property' in obj
    && typeof obj.property === 'string';
}

/**
 * 创建样式属性求值器
 *
 * @param value - 样式属性值
 * @param defaultValue - 默认值
 * @returns 样式属性求值器
 */
export function createStylePropertyEvaluator<T = unknown>(
  value: StylePropertyValue<T>,
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  if (isExpression(value)) {
    return createExpressionEvaluator(value, defaultValue);
  }

  if (isZoomPropertyFunction(value)) {
    return createZoomPropertyEvaluator(value, defaultValue);
  }

  if (isIdentityFunction(value)) {
    return createIdentityEvaluator(value, defaultValue);
  }

  if (isPropertyFunction(value)) {
    return createPropertyEvaluator(value, defaultValue);
  }

  if (isZoomFunction(value)) {
    return createZoomEvaluator(value, defaultValue);
  }

  return createStaticEvaluator(value, defaultValue);
}

/**
 * 创建静态值求值器
 */
function createStaticEvaluator<T>(
  value: T,
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  const resolvedValue = value ?? defaultValue;
  return () => resolvedValue as T;
}

/**
 * 创建表达式求值器
 */
function createExpressionEvaluator<T>(
  expression: unknown[],
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  return (context: StylePropertyContext): T => {
    const result = evaluateExpression(expression, context);
    return (result ?? defaultValue) as T;
  };
}

/**
 * 创建 Zoom 函数求值器
 */
function createZoomEvaluator<T>(
  func: ZoomFunction<T>,
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  const stops = func.stops;
  const base = func.base ?? 1;

  return (context: StylePropertyContext): T => {
    const zoom = context.zoom;

    if (stops.length === 0) {
      return defaultValue as T;
    }

    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    if (zoom <= firstStop[0]) {
      return firstStop[1] ?? defaultValue as T;
    }

    if (zoom >= lastStop[0]) {
      return lastStop[1] ?? defaultValue as T;
    }

    for (let i = 0; i < stops.length - 1; i++) {
      const [z1, v1] = stops[i];
      const [z2, v2] = stops[i + 1];

      if (zoom >= z1 && zoom <= z2) {
        const t = exponentialInterpolation(zoom, base, z1, z2);
        return interpolateValue(v1, v2, t) ?? defaultValue as T;
      }
    }

    return defaultValue as T;
  };
}

/**
 * MapLibre 指数插值公式
 */
function exponentialInterpolation(
  input: number,
  base: number,
  lower: number,
  upper: number,
): number {
  const difference = upper - lower;
  const progress = input - lower;

  if (difference === 0) {
    return 0;
  }

  if (base === 1) {
    return progress / difference;
  }

  return (base ** progress - 1) / (base ** difference - 1);
}

/**
 * 创建属性函数求值器
 */
function createPropertyEvaluator<T>(
  func: PropertyFunction<T>,
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  const { property, stops, type = 'exponential' } = func;
  const fallback = func.default ?? defaultValue;

  return (context: StylePropertyContext): T => {
    const propertyValue = context.properties[property];

    if (propertyValue === undefined || propertyValue === null) {
      return fallback as T;
    }

    if (type === 'categorical') {
      for (const [key, value] of stops) {
        if (key === propertyValue) {
          return value ?? fallback as T;
        }
      }
      return fallback as T;
    }

    if (type === 'interval') {
      for (let i = stops.length - 1; i >= 0; i--) {
        const [key, value] = stops[i];
        if (typeof key === 'number' && typeof propertyValue === 'number') {
          if (propertyValue >= key) {
            return value ?? fallback as T;
          }
        }
      }
      return fallback as T;
    }

    if (typeof propertyValue !== 'number') {
      return fallback as T;
    }

    for (let i = 0; i < stops.length - 1; i++) {
      const [k1, v1] = stops[i];
      const [k2, v2] = stops[i + 1];

      if (typeof k1 === 'number' && typeof k2 === 'number') {
        if (propertyValue >= k1 && propertyValue < k2) {
          if (typeof v1 === 'number' && typeof v2 === 'number') {
            const t = (propertyValue - k1) / (k2 - k1);
            return interpolateValue(v1, v2, t) ?? fallback as T;
          }
          return v1 ?? fallback as T;
        }
      }
    }

    const lastStop = stops[stops.length - 1];
    if (lastStop && typeof lastStop[0] === 'number') {
      if (propertyValue >= lastStop[0]) {
        return lastStop[1] ?? fallback as T;
      }
    }

    return fallback as T;
  };
}

/**
 * 创建 Identity 函数求值器
 */
function createIdentityEvaluator<T>(
  func: IdentityFunction<T>,
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  const { property } = func;
  const fallback = func.default ?? defaultValue;

  return (context: StylePropertyContext): T => {
    const propertyValue = context.properties[property];
    return (propertyValue ?? fallback) as T;
  };
}

/**
 * 创建 Zoom + 属性组合函数求值器
 */
function createZoomPropertyEvaluator<T>(
  func: ZoomPropertyFunction<T>,
  defaultValue?: T,
): StylePropertyEvaluator<T> {
  const { property, stops } = func;
  const fallback = func.default ?? defaultValue;

  return (context: StylePropertyContext): T => {
    const propertyValue = context.properties[property];

    const matchingStops: Array<[number, T]> = [];

    for (const [stop, value] of stops) {
      if (stop.value === propertyValue) {
        matchingStops.push([stop.zoom, value]);
      }
    }

    if (matchingStops.length === 0) {
      return fallback as T;
    }

    matchingStops.sort((a, b) => a[0] - b[0]);

    const zoomFunc: ZoomFunction<T> = { stops: matchingStops };
    return createZoomEvaluator(zoomFunc, fallback)(context);
  };
}

/**
 * 插值两个值
 */
function interpolateValue<T>(v1: T, v2: T, t: number): T {
  if (typeof v1 === 'number' && typeof v2 === 'number') {
    return (v1 + t * (v2 - v1)) as T;
  }

  if (typeof v1 === 'string' && typeof v2 === 'string') {
    return interpolateColor(v1, v2, t) as T;
  }

  return t < 0.5 ? v1 : v2;
}

/**
 * 颜色插值（简化版本，复用 expression-evaluator 中的逻辑）
 */
function interpolateColor(color1: string, color2: string, t: number): string {
  const hex1 = parseHexColor(color1);
  const hex2 = parseHexColor(color2);

  if (!hex1 || !hex2) {
    return t < 0.5 ? color1 : color2;
  }

  const r = Math.round(hex1.r + t * (hex2.r - hex1.r));
  const g = Math.round(hex1.g + t * (hex2.g - hex1.g));
  const b = Math.round(hex1.b + t * (hex2.b - hex1.b));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 解析十六进制颜色
 */
function parseHexColor(color: string): { b: number; g: number; r: number } | null {
  const hex = color.replace('#', '');

  if (hex.length === 6) {
    return {
      b: Number.parseInt(hex.slice(4, 6), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      r: Number.parseInt(hex.slice(0, 2), 16),
    };
  }

  if (hex.length === 3) {
    return {
      b: Number.parseInt(hex[2] + hex[2], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      r: Number.parseInt(hex[0] + hex[0], 16),
    };
  }

  return null;
}
