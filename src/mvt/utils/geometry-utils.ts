/**
 * 几何计算工具函数
 *
 * 提供点插值、距离计算等几何操作。
 * 这些函数用于处理瓦片坐标系统中的几何计算。
 */
import type Point from '@mapbox/point-geometry';
import { createPoint } from './point-utils';

/**
 * 在两个点之间进行线性插值
 * @param start - 起始点
 * @param end - 终点
 * @param ratio - 插值比例 (0-1)
 * @returns 插值后的点
 */
export function interpolatePoint(
  start: Pick<Point, 'x' | 'y'>,
  end: Pick<Point, 'x' | 'y'>,
  ratio: number,
): Point {
  return createPoint(
    start.x + (end.x - start.x) * ratio,
    start.y + (end.y - start.y) * ratio,
  );
}

/**
 * 计算线段与水平线的交点
 * @param start - 线段起点
 * @param end - 线段终点
 * @param y - 水平线的 Y 坐标
 * @returns 交点
 */
export function interpolateHorizontalIntersection(start: Point, end: Point, y: number): Point {
  const ratio = start.y === end.y ? 0 : (y - start.y) / (end.y - start.y);
  return createPoint(start.x + (end.x - start.x) * ratio, y);
}

/**
 * 计算线段与垂直线的交点
 * @param start - 线段起点
 * @param end - 线段终点
 * @param x - 垂直线的 X 坐标
 * @returns 交点
 */
export function interpolateVerticalIntersection(start: Point, end: Point, x: number): Point {
  const ratio = start.x === end.x ? 0 : (x - start.x) / (end.x - start.x);
  return createPoint(x, start.y + (end.y - start.y) * ratio);
}

/**
 * 计算两点之间的欧几里得距离
 * @param start - 起点
 * @param end - 终点
 * @returns 两点之间的距离
 */
export function distanceBetweenPoints(
  start: Pick<Point, 'x' | 'y'>,
  end: Pick<Point, 'x' | 'y'>,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return Math.hypot(deltaX, deltaY);
}
