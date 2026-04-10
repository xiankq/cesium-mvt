import {
  Cartesian3,
  WebMercatorProjection,
} from 'cesium';
import { isValidNumber } from './utils';

/**
 * 瓦片投影模块
 *
 * 该模块负责将瓦片坐标系中的点转换为世界坐标系（Cartesian3）。
 *
 * 坐标系统说明：
 * - 瓦片坐标系：原点在左上角，x 轴向右，y 轴向下，范围 [0, extent]
 * - WebMercator 坐标系：原点在赤道和本初子午线交点，x 轴向东，y 轴向北
 * - 世界坐标系（Cartesian3）：地心坐标系，原点在地球中心
 *
 * 转换流程：
 * 瓦片坐标 → WebMercator 坐标 → 地理坐标（经纬度） → 世界坐标（Cartesian3）
 */

/**
 * 瓦片投影数据
 *
 * 定义瓦片在 WebMercator 坐标系中的边界范围
 */
export interface TileProjectionData {
  east: number;
  north: number;
  south: number;
  west: number;
}

/**
 * 瓦片投影上下文
 *
 * 包含投影所需的投影器和瓦片边界信息
 */
export interface TileProjectionContext {
  projection: WebMercatorProjection;
  tileRectangle: TileProjectionData;
}

/**
 * 创建瓦片投影上下文
 *
 * @param data - 瓦片投影数据
 * @returns 瓦片投影上下文
 */
export function createTileProjectionContext(
  data: TileProjectionData,
): TileProjectionContext {
  return {
    projection: new WebMercatorProjection(),
    tileRectangle: data,
  };
}

/**
 * 投影瓦片点到世界坐标
 *
 * 将瓦片坐标系中的点转换为 Cartesian3 世界坐标
 *
 * 转换步骤：
 * 1. 将瓦片坐标归一化到 [0, 1] 范围
 * 2. 根据瓦片边界计算 WebMercator 坐标
 * 3. 反投影 WebMercator 坐标得到地理坐标
 * 4. 从地理坐标生成 Cartesian3 世界坐标
 *
 * @param point - 瓦片坐标点
 * @param point.x - x 坐标
 * @param point.y - y 坐标
 * @param extent - 瓦片范围（通常为 4096）
 * @param context - 瓦片投影上下文
 * @param heightOffset - 高度偏移量（默认为 0）
 * @returns 世界坐标点
 */
export function projectTilePoint(
  point: { x: number; y: number },
  extent: number,
  context: TileProjectionContext,
  heightOffset: number = 0,
): Cartesian3 {
  const { projection, tileRectangle } = context;

  if (!isValidNumber(tileRectangle.west) || !isValidNumber(tileRectangle.south)
    || !isValidNumber(tileRectangle.east) || !isValidNumber(tileRectangle.north)) {
    return new Cartesian3(0, 0, 0);
  }

  const u = point.x / extent;
  const v = point.y / extent;
  if (!isValidNumber(u) || !isValidNumber(v)) {
    return new Cartesian3(0, 0, 0);
  }

  const nativeWidth = tileRectangle.east - tileRectangle.west;
  const nativeHeight = tileRectangle.north - tileRectangle.south;
  const nativeX = tileRectangle.west + u * nativeWidth;
  // 向量瓦片坐标以左上角为原点，y 轴向下增长，需要翻转成 WebMercator 原生坐标。
  const nativeY = tileRectangle.north - v * nativeHeight;
  if (!isValidNumber(nativeX) || !isValidNumber(nativeY)) {
    return new Cartesian3(0, 0, 0);
  }

  const cartographic = projection.unproject(new Cartesian3(nativeX, nativeY, 0));
  if (!isValidNumber(cartographic.longitude) || !isValidNumber(cartographic.latitude)) {
    return new Cartesian3(0, 0, 0);
  }

  return Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    heightOffset,
  );
}
