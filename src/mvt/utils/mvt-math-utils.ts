/**
 * 数学计算工具函数
 *
 * 提供常用的数学操作，如数值限制、线性插值等。
 */

/**
 * 将数值限制在指定范围内
 * @param value - 要限制的值
 * @param min - 最小值
 * @param max - 最大值
 * @returns 限制后的值
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 将数值限制在 0-1 范围内
 * @param value - 要限制的值
 * @returns 限制后的值 (0-1)
 */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * 确保数值为非负数
 * @param value - 要检查的值
 * @param minValue - 最小值，默认为 0
 * @returns 非负数值
 */
export function ensurePositive(value: number, minValue = 0): number {
  return Math.max(minValue, value);
}

/**
 * 确保数值不小于指定最小值
 * @param value - 要检查的值
 * @param minimum - 最小值，默认为 1
 * @returns 不小于最小值的数值
 */
export function ensureMinimum(value: number, minimum = 1): number {
  return Math.max(minimum, value);
}

/**
 * 线性插值
 * @param start - 起始值
 * @param end - 结束值
 * @param t - 插值参数 (0-1)
 * @returns 插值结果
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
