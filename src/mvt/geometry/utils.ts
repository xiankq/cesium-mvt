/**
 * 几何工具模块
 *
 * 提供几何计算中常用的常量和工具函数
 */

/**
 * 默认瓦片范围
 *
 * 向量瓦片的标准范围是 4096，表示瓦片坐标系的范围是 [0, 4096]
 */
export const DEFAULT_EXTENT = 4096;

/**
 * 验证数值是否有效
 *
 * 检查值是否为有限数字（非 NaN、非 Infinity）
 *
 * @param value - 待验证的值
 * @returns 如果是有限数字则返回 true，否则返回 false
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
