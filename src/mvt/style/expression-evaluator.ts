import type { Color } from 'cesium';
import { Color as CesiumColor } from 'cesium';

/**
 * 表达式求值器模块
 *
 * 该模块实现了 MapLibre Style Specification 表达式的求值功能。
 *
 * 支持的表达式类型：
 * - 字面量：字符串、数字、布尔值、null
 * - 属性访问：get, has, id, geometry-type, properties
 * - 数学运算：+, -, *, /, %, ^
 * - 比较运算：==, !=, <, <=, >, >=
 * - 逻辑运算：all, any, !
 * - 条件表达式：case, match, coalesce
 * - 插值表达式：interpolate, step
 * - 类型转换：to-number, to-string, to-boolean, typeof
 * - 字符串操作：concat, downcase, upcase, length
 * - 数学函数：abs, floor, ceil, round, min, max, sqrt, ln, log2, log10, sin, cos, pi, e
 * - 数组操作：at, length
 * - 特殊变量：zoom
 */

/**
 * 表达式上下文
 *
 * 提供表达式求值所需的环境信息
 */
export interface ExpressionContext {
  geometryType?: string;
  id?: number | string;
  featureState?: Record<string, unknown>;
  properties: Record<string, unknown>;
  zoom?: number;
}

/**
 * 表达式类型
 *
 * 表达式可以是：
 * - 字面量值（string | number | boolean | null）
 * - 表达式数组（第一个元素是操作符，后面是参数）
 */
export type Expression = unknown;

/**
 * 表达式求值器
 *
 * 将 MapLibre 表达式求值为具体值
 *
 * @param expression - 表达式
 * @param context - 求值上下文
 * @returns 求值结果
 */
export function evaluateExpression(
  expression: Expression,
  context: ExpressionContext,
): unknown {
  if (isLiteral(expression)) {
    return expression;
  }

  if (!isArrayExpression(expression)) {
    return expression;
  }

  const [operator, ...args] = expression as unknown[];

  switch (operator) {
    case 'get':
      return evaluateGet(args, context);
    case 'has':
      return evaluateHas(args, context);
    case 'id':
      return context.id;
    case 'geometry-type':
      return context.geometryType;
    case 'properties':
      return context.properties;
    case 'zoom':
      return context.zoom;
    case 'feature-state':
      return evaluateFeatureState(args, context);

    case '+':
      return evaluateAdd(args, context);
    case '-':
      return evaluateSubtract(args, context);
    case '*':
      return evaluateMultiply(args, context);
    case '/':
      return evaluateDivide(args, context);
    case '%':
      return evaluateModulo(args, context);
    case '^':
      return evaluatePower(args, context);

    case '==':
      return evaluateEqual(args, context);
    case '!=':
      return evaluateNotEqual(args, context);
    case '<':
      return evaluateLessThan(args, context);
    case '<=':
      return evaluateLessThanOrEqual(args, context);
    case '>':
      return evaluateGreaterThan(args, context);
    case '>=':
      return evaluateGreaterThanOrEqual(args, context);

    case 'all':
      return evaluateAll(args, context);
    case 'any':
      return evaluateAny(args, context);
    case '!':
      return evaluateNot(args, context);

    case 'case':
      return evaluateCase(args, context);
    case 'match':
      return evaluateMatch(args, context);
    case 'coalesce':
      return evaluateCoalesce(args, context);

    case 'interpolate':
      return evaluateInterpolate(args, context);
    case 'step':
      return evaluateStep(args, context);

    case 'to-number':
      return evaluateToNumber(args, context);
    case 'to-string':
      return evaluateToString(args, context);
    case 'to-boolean':
      return evaluateToBoolean(args, context);
    case 'typeof':
      return evaluateTypeof(args, context);

    case 'concat':
      return evaluateConcat(args, context);
    case 'downcase':
      return evaluateDowncase(args, context);
    case 'upcase':
      return evaluateUpcase(args, context);
    case 'length':
      return evaluateLength(args, context);

    case 'abs':
      return evaluateAbs(args, context);
    case 'floor':
      return evaluateFloor(args, context);
    case 'ceil':
      return evaluateCeil(args, context);
    case 'round':
      return evaluateRound(args, context);
    case 'min':
      return evaluateMin(args, context);
    case 'max':
      return evaluateMax(args, context);
    case 'sqrt':
      return evaluateSqrt(args, context);
    case 'ln':
      return evaluateLn(args, context);
    case 'log2':
      return evaluateLog2(args, context);
    case 'log10':
      return evaluateLog10(args, context);
    case 'sin':
      return evaluateSin(args, context);
    case 'cos':
      return evaluateCos(args, context);
    case 'pi':
      return Math.PI;
    case 'e':
      return Math.E;

    case 'at':
      return evaluateAt(args, context);
    case 'literal':
      return args[0];

    default:
      throw new Error(`Unknown expression operator: ${operator}`);
  }
}

/**
 * 判断是否为字面量值
 */
function isLiteral(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  );
}

/**
 * 判断是否为数组表达式
 */
function isArrayExpression(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * 求值所有参数
 */
function evaluateArgs(args: unknown[], context: ExpressionContext): unknown[] {
  return args.map(arg => evaluateExpression(arg, context));
}

/**
 * 获取数值参数
 */
function getNumberArg(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num;
    }
  }
  throw new Error(`Expected number, got: ${typeof value}`);
}

/**
 * 获取字符串参数
 */
function getStringArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  throw new Error(`Expected string, got: ${typeof value}`);
}

/**
 * get 表达式 - 获取属性值
 */
function evaluateGet(args: unknown[], context: ExpressionContext): unknown {
  const propertyName = getStringArg(args[0]);
  return context.properties[propertyName];
}

function evaluateFeatureState(args: unknown[], context: ExpressionContext): unknown {
  if (args.length === 0) {
    return undefined;
  }

  const propertyName = getStringArg(evaluateExpression(args[0], context));
  return context.featureState?.[propertyName];
}

/**
 * has 表达式 - 检查属性是否存在
 */
function evaluateHas(args: unknown[], context: ExpressionContext): boolean {
  const propertyName = getStringArg(args[0]);
  return propertyName in context.properties;
}

/**
 * + 表达式 - 加法运算
 */
function evaluateAdd(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  return values.reduce((sum: number, value) => sum + getNumberArg(value), 0);
}

/**
 * - 表达式 - 减法运算
 */
function evaluateSubtract(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);

  if (values.length === 1) {
    return -getNumberArg(values[0]);
  }

  const first = getNumberArg(values[0]);
  return values.slice(1).reduce((result: number, value) => result - getNumberArg(value), first);
}

/**
 * 表达式 - 乘法运算
 */
function evaluateMultiply(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  return values.reduce((product: number, value) => product * getNumberArg(value), 1);
}

/**
 * / 表达式 - 除法运算
 *
 * MapLibre 直接执行 JS 除法：x/0 返回 Infinity/-Infinity，0/0 返回 NaN
 * 上层 StyleExpression.evaluate() 会拦截 NaN 返回默认值
 */
function evaluateDivide(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  const first = getNumberArg(values[0]);
  const second = getNumberArg(values[1]);

  return first / second;
}

/**
 * % 表达式 - 取模运算
 *
 * MapLibre 直接执行 JS 取模：x%0 返回 NaN，由上层拦截返回默认值
 */
function evaluateModulo(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  const first = getNumberArg(values[0]);
  const second = getNumberArg(values[1]);

  if (second === 0) {
    return 0;
  }

  return first % second;
}

/**
 * ^ 表达式 - 幂运算
 */
function evaluatePower(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  const base = getNumberArg(values[0]);
  const exponent = getNumberArg(values[1]);
  return base ** exponent;
}

/**
 * == 表达式 - 相等比较
 */
function evaluateEqual(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return values[0] === values[1];
}

/**
 * != 表达式 - 不相等比较
 */
function evaluateNotEqual(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return values[0] !== values[1];
}

/**
 * < 表达式 - 小于比较
 */
function evaluateLessThan(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return getNumberArg(values[0]) < getNumberArg(values[1]);
}

/**
 * <= 表达式 - 小于等于比较
 */
function evaluateLessThanOrEqual(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return getNumberArg(values[0]) <= getNumberArg(values[1]);
}

/**
 * > 表达式 - 大于比较
 */
function evaluateGreaterThan(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return getNumberArg(values[0]) > getNumberArg(values[1]);
}

/**
 * >= 表达式 - 大于等于比较
 */
function evaluateGreaterThanOrEqual(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return getNumberArg(values[0]) >= getNumberArg(values[1]);
}

/**
 * all 表达式 - 逻辑与（短路求值）
 *
 * MapLibre 规范要求 all 必须短路求值：遇到第一个 falsy 值即返回 false
 */
function evaluateAll(args: unknown[], context: ExpressionContext): boolean {
  for (const arg of args) {
    if (!evaluateExpression(arg, context)) {
      return false;
    }
  }
  return true;
}

/**
 * any 表达式 - 逻辑或（短路求值）
 *
 * MapLibre 规范要求 any 必须短路求值：遇到第一个 truthy 值即返回 true
 */
function evaluateAny(args: unknown[], context: ExpressionContext): boolean {
  for (const arg of args) {
    if (evaluateExpression(arg, context)) {
      return true;
    }
  }
  return false;
}

/**
 * ! 表达式 - 逻辑非
 */
function evaluateNot(args: unknown[], context: ExpressionContext): boolean {
  const values = evaluateArgs(args, context);
  return !values[0];
}

/**
 * case 表达式 - 条件选择
 *
 * 格式: ['case', condition1, output1, condition2, output2, ..., defaultOutput]
 */
function evaluateCase(args: unknown[], context: ExpressionContext): unknown {
  for (let i = 0; i < args.length - 1; i += 2) {
    const condition = evaluateExpression(args[i], context);
    if (condition) {
      return evaluateExpression(args[i + 1], context);
    }
  }

  return evaluateExpression(args[args.length - 1], context);
}

/**
 * match 表达式 - 模式匹配
 *
 * 格式: ['match', input, match1, output1, match2, output2, ..., defaultOutput]
 */
function evaluateMatch(args: unknown[], context: ExpressionContext): unknown {
  const input = evaluateExpression(args[0], context);

  for (let i = 1; i < args.length - 1; i += 2) {
    const matchValue = args[i];
    const output = args[i + 1];

    if (Array.isArray(matchValue)) {
      if (matchValue.includes(input)) {
        return evaluateExpression(output, context);
      }
    }
    else {
      if (matchValue === input) {
        return evaluateExpression(output, context);
      }
    }
  }

  return evaluateExpression(args[args.length - 1], context);
}

/**
 * coalesce 表达式 - 返回第一个非 null 值
 */
function evaluateCoalesce(args: unknown[], context: ExpressionContext): unknown {
  for (const arg of args) {
    const value = evaluateExpression(arg, context);
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

/**
 * interpolate 表达式 - 插值
 *
 * 格式: ['interpolate', interpolation, input, stop1, output1, stop2, output2, ...]
 */
function evaluateInterpolate(args: unknown[], context: ExpressionContext): unknown {
  const input = getNumberArg(evaluateExpression(args[1], context));

  const stops: Array<{ stop: number; output: unknown }> = [];
  for (let i = 2; i < args.length; i += 2) {
    stops.push({
      output: evaluateExpression(args[i + 1], context),
      stop: getNumberArg(evaluateExpression(args[i], context)),
    });
  }

  if (stops.length === 0) {
    return null;
  }

  if (input <= stops[0].stop) {
    return stops[0].output;
  }

  if (input >= stops[stops.length - 1].stop) {
    return stops[stops.length - 1].output;
  }

  for (let i = 0; i < stops.length - 1; i++) {
    if (input >= stops[i].stop && input <= stops[i + 1].stop) {
      const t = (input - stops[i].stop) / (stops[i + 1].stop - stops[i].stop);

      const output1 = stops[i].output;
      const output2 = stops[i + 1].output;

      if (typeof output1 === 'number' && typeof output2 === 'number') {
        return output1 + t * (output2 - output1);
      }

      if (typeof output1 === 'string' && typeof output2 === 'string') {
        return interpolateColor(output1, output2, t);
      }

      return output1;
    }
  }

  return null;
}

/**
 * 颜色插值
 */
function interpolateColor(color1: string, color2: string, t: number): string {
  const c1 = CesiumColor.fromCssColorString(color1);
  const c2 = CesiumColor.fromCssColorString(color2);

  if (!c1 || !c2) {
    return color1;
  }

  const result = new CesiumColor();
  CesiumColor.lerp(c1, c2, t, result);

  return colorToHex(result);
}

/**
 * Color 转十六进制字符串
 */
function colorToHex(color: Color): string {
  const r = Math.round(color.red * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.green * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.blue * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * step 表达式 - 阶梯函数
 *
 * 格式: ['step', input, defaultOutput, stop1, output1, stop2, output2, ...]
 */
function evaluateStep(args: unknown[], context: ExpressionContext): unknown {
  const input = getNumberArg(evaluateExpression(args[0], context));
  let defaultOutput = evaluateExpression(args[1], context);

  for (let i = 2; i < args.length; i += 2) {
    const stop = getNumberArg(evaluateExpression(args[i], context));
    const output = evaluateExpression(args[i + 1], context);

    if (input < stop) {
      return defaultOutput;
    }

    defaultOutput = output;
  }

  return defaultOutput;
}

/**
 * to-number 表达式 - 转换为数字
 */
function evaluateToNumber(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return getNumberArg(value);
}

/**
 * to-string 表达式 - 转换为字符串
 */
function evaluateToString(args: unknown[], context: ExpressionContext): string {
  const value = evaluateExpression(args[0], context);
  return String(value);
}

/**
 * to-boolean 表达式 - 转换为布尔值
 */
function evaluateToBoolean(args: unknown[], context: ExpressionContext): boolean {
  const value = evaluateExpression(args[0], context);
  return Boolean(value);
}

/**
 * typeof 表达式 - 获取类型
 */
function evaluateTypeof(args: unknown[], context: ExpressionContext): string {
  const value = evaluateExpression(args[0], context);

  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

/**
 * concat 表达式 - 字符串连接
 */
function evaluateConcat(args: unknown[], context: ExpressionContext): string {
  const values = evaluateArgs(args, context);
  return values.map(v => String(v)).join('');
}

/**
 * downcase 表达式 - 转小写
 */
function evaluateDowncase(args: unknown[], context: ExpressionContext): string {
  const value = evaluateExpression(args[0], context);
  return getStringArg(value).toLowerCase();
}

/**
 * upcase 表达式 - 转大写
 */
function evaluateUpcase(args: unknown[], context: ExpressionContext): string {
  const value = evaluateExpression(args[0], context);
  return getStringArg(value).toUpperCase();
}

/**
 * length 表达式 - 获取长度
 */
function evaluateLength(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);

  if (typeof value === 'string') {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  return 0;
}

/**
 * abs 表达式 - 绝对值
 */
function evaluateAbs(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return Math.abs(getNumberArg(value));
}

/**
 * floor 表达式 - 向下取整
 */
function evaluateFloor(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return Math.floor(getNumberArg(value));
}

/**
 * ceil 表达式 - 向上取整
 */
function evaluateCeil(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return Math.ceil(getNumberArg(value));
}

/**
 * round 表达式 - 四舍五入
 */
function evaluateRound(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return Math.round(getNumberArg(value));
}

/**
 * min 表达式 - 最小值
 */
function evaluateMin(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  return Math.min(...values.map(v => getNumberArg(v)));
}

/**
 * max 表达式 - 最大值
 */
function evaluateMax(args: unknown[], context: ExpressionContext): number {
  const values = evaluateArgs(args, context);
  return Math.max(...values.map(v => getNumberArg(v)));
}

/**
 * sqrt 表达式 - 平方根
 *
 * MapLibre 直接调用 Math.sqrt()，负数返回 NaN，由上层 StyleExpression.evaluate() 兜底
 */
function evaluateSqrt(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  const num = getNumberArg(value);

  return Math.sqrt(num);
}

/**
 * ln 表达式 - 自然对数
 *
 * MapLibre 直接调用 Math.log()：ln(0) 返回 -Infinity，负数返回 NaN
 * 上层 StyleExpression.evaluate() 会拦截 NaN 返回默认值，但不拦截 -Infinity
 */
function evaluateLn(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  const num = getNumberArg(value);

  return Math.log(num);
}

/**
 * log2 表达式 - 以 2 为底的对数
 *
 * MapLibre 行为：log2(0) 返回 -Infinity，负数返回 NaN
 */
function evaluateLog2(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  const num = getNumberArg(value);

  return Math.log2(num);
}

/**
 * log10 表达式 - 以 10 为底的对数
 *
 * MapLibre 行为：log10(0) 返回 -Infinity，负数返回 NaN
 */
function evaluateLog10(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  const num = getNumberArg(value);

  return Math.log10(num);
}

/**
 * sin 表达式 - 正弦
 */
function evaluateSin(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return Math.sin(getNumberArg(value));
}

/**
 * cos 表达式 - 余弦
 */
function evaluateCos(args: unknown[], context: ExpressionContext): number {
  const value = evaluateExpression(args[0], context);
  return Math.cos(getNumberArg(value));
}

/**
 * at 表达式 - 数组访问
 *
 * MapLibre 规范：负索引应抛出异常，越界返回 undefined
 * 当前实现：负索引和越界均返回 undefined（不抛异常的安全版本）
 */
function evaluateAt(args: unknown[], context: ExpressionContext): unknown {
  const index = getNumberArg(evaluateExpression(args[0], context));
  const array = evaluateExpression(args[1], context);

  if (Array.isArray(array)) {
    // MapLibre 不支持负索引，直接返回 undefined
    if (index < 0 || index >= array.length || index !== Math.floor(index)) {
      return undefined;
    }
    return array[index];
  }

  return undefined;
}
