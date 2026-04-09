/**
 * Point 几何操作工具函数
 *
 * 提供对 @mapbox/point-geometry Point 对象的创建、克隆和比较操作。
 * 这些函数用于统一处理瓦片坐标系统中的点操作。
 */
import type Point from '@mapbox/point-geometry';

/**
 * 创建一个新的 Point 对象
 * @param x - X 坐标
 * @param y - Y 坐标
 * @returns Point 对象
 */
export function createPoint(x: number, y: number): Point {
  return { x, y } as Point;
}

/**
 * 克隆一个 Point 对象
 * @param point - 要克隆的点
 * @returns 新的 Point 对象
 */
export function clonePoint(point: Pick<Point, 'x' | 'y'>): Point {
  return createPoint(point.x, point.y);
}

/**
 * 克隆一个 Point 数组
 * @param points - 要克隆的点数组
 * @returns 新的 Point 数组
 */
export function clonePoints(points: readonly Point[]): Point[] {
  return points.map(p => clonePoint(p));
}

/**
 * 检查两个点是否相等
 * @param left - 第一个点
 * @param right - 第二个点
 * @returns 如果两点的 x 和 y 坐标都相等则返回 true
 */
export function arePointsEqual(left: Pick<Point, 'x' | 'y'>, right: Pick<Point, 'x' | 'y'>): boolean {
  return left.x === right.x && left.y === right.y;
}
