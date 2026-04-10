import {
  Cartesian3,
  WebMercatorProjection,
} from 'cesium';
import { isValidNumber } from './utils';

export interface TileProjectionData {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface TileProjectionContext {
  projection: WebMercatorProjection;
  tileRectangle: TileProjectionData;
}

export function createTileProjectionContext(
  data: TileProjectionData,
): TileProjectionContext {
  return {
    projection: new WebMercatorProjection(),
    tileRectangle: data,
  };
}

export function projectTilePoint(
  point: { x: number; y: number },
  extent: number,
  context: TileProjectionContext,
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
    0,
  );
}
