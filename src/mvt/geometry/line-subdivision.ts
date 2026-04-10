import { Cartesian3, Ellipsoid } from 'cesium';
import { isValidNumber } from './utils';

/**
 * 测地线细分算法
 *
 * 该模块实现了在地球表面细分线段的算法，用于确保长距离线段能够正确贴合地球曲率。
 *
 * 算法原理：
 * 1. 测地线距离：在球面上，两点之间的最短路径是大圆弧
 * 2. 弦误差控制：通过最大弦误差参数控制细分精度，弦误差越小，细分越精细
 * 3. 高度插值：在细分过程中保持起点和终点的高度，并进行线性插值
 *
 * 应用场景：
 * - 线要素渲染：确保长距离线段在地球表面正确显示
 * - 多边形边界：处理跨越长距离的多边形边界
 */

/**
 * 细分线段以适应地球曲率
 *
 * 在球面上，长距离的直线需要细分为多个短段，
 * 以确保渲染时能够正确贴合地球表面
 *
 * 算法步骤：
 * 1. 检查起点和终点是否相同，如果相同则直接返回
 * 2. 验证坐标有效性，无效则返回原始点
 * 3. 计算两点间的距离，如果距离小于两倍弦误差则无需细分
 * 4. 根据弦误差计算细分段数
 * 5. 在起点和终点之间进行线性插值，生成细分点
 * 6. 对每个细分点进行高度插值，保持高度变化
 *
 * @param start - 线段起点
 * @param end - 线段终点
 * @param maxChordError - 最大弦误差，控制细分精度（单位：米）
 * @returns 细分后的点数组
 */
export function subdivideLine(
  start: Cartesian3,
  end: Cartesian3,
  maxChordError: number,
): Cartesian3[] {
  if (Cartesian3.equals(start, end)) {
    return [start];
  }

  if (!isValidCartesian3(start) || !isValidCartesian3(end)) {
    return [start, end];
  }

  const distance = Cartesian3.distance(start, end);

  if (distance < maxChordError * 2) {
    return [start, end];
  }

  const ellipsoidMaximumRadius = Ellipsoid.WGS84.maximumRadius;

  const chordErrorRatio = maxChordError / ellipsoidMaximumRadius;
  const subdivisionAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - chordErrorRatio)));
  const subdivisions = Math.ceil(Math.PI / subdivisionAngle);

  const actualSubdivisions = Math.max(2, Math.min(subdivisions, Math.floor(distance / maxChordError)));

  if (actualSubdivisions <= 1) {
    return [start, end];
  }

  const startMagnitude = Cartesian3.magnitude(start);
  const endMagnitude = Cartesian3.magnitude(end);

  const points: Cartesian3[] = [start];
  for (let i = 1; i < actualSubdivisions; i++) {
    const t = i / actualSubdivisions;
    const point = Cartesian3.lerp(start, end, t, new Cartesian3());

    const magnitude = Cartesian3.magnitude(point);
    if (magnitude > 0) {
      const normalized = Cartesian3.normalize(point, new Cartesian3());

      const interpolatedMagnitude = startMagnitude + (endMagnitude - startMagnitude) * t;

      const scaled = Cartesian3.multiplyByScalar(
        normalized,
        interpolatedMagnitude,
        new Cartesian3(),
      );
      points.push(scaled);
    }
  }
  points.push(end);

  return points;
}

/**
 * 细分闭合环
 *
 * 对环中的每条边进行细分，用于处理多边形边界
 *
 * @param ring - 闭合环的点数组
 * @param maxChordError - 最大弦误差
 * @returns 细分后的环点数组
 */
export function subdivideRing(
  ring: Cartesian3[],
  maxChordError: number,
): Cartesian3[] {
  if (ring.length < 2) {
    return ring;
  }

  const subdivided: Cartesian3[] = [];

  for (let i = 0; i < ring.length - 1; i++) {
    const segment = subdivideLine(ring[i], ring[i + 1], maxChordError);
    subdivided.push(...segment.slice(0, -1));
  }

  subdivided.push(ring[ring.length - 1]);

  return subdivided;
}

/**
 * 验证 Cartesian3 坐标是否有效
 *
 * 检查坐标的所有分量是否为有效数字
 *
 * @param point - 待验证的点
 * @returns 如果所有分量都是有效数字则返回 true
 */
function isValidCartesian3(point: Cartesian3): boolean {
  return isValidNumber(point.x) && isValidNumber(point.y) && isValidNumber(point.z);
}
