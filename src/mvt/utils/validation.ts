/**
 * 数据验证工具函数
 *
 * 提供通用的数据验证函数，用于确保几何数据的有效性
 */

/**
 * 验证TypedArray中的所有值是否为有效数字
 *
 * @param positions - 待验证的TypedArray
 * @returns 如果所有值都是有效数字则返回true，否则返回false
 */
export function validatePositions(positions: Float64Array): boolean {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      return false;
    }
  }
  return true;
}

/**
 * 验证对象是否为有效的TypedArray实例
 *
 * @param data - 待验证的对象
 * @param Type - 期望的TypedArray构造函数
 * @returns 如果对象是指定类型的TypedArray实例则返回true
 */
export function isValidTypedArray<T extends TypedArrayConstructor>(
  data: unknown,
  Type: T,
): data is InstanceType<T> {
  return data instanceof Type;
}

type TypedArrayConstructor
  = | Float32ArrayConstructor
    | Float64ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Uint8ArrayConstructor;
