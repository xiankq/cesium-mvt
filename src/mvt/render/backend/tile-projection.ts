import type Point from '@mapbox/point-geometry';
import type {
  WebMercatorProjection,

  WebMercatorTilingScheme,
} from 'cesium';
import {
  Cartesian3,
} from 'cesium';

export interface TileProjectionContext {
  projection: WebMercatorProjection;
  tileRectangle: ReturnType<WebMercatorTilingScheme['tileXYToNativeRectangle']>;
}

export function createTileProjectionContext(
  level: number,
  x: number,
  y: number,
  tilingScheme: WebMercatorTilingScheme,
): TileProjectionContext {
  return {
    projection: tilingScheme.projection as WebMercatorProjection,
    tileRectangle: tilingScheme.tileXYToNativeRectangle(x, y, level),
  };
}

export function projectTilePoint(
  point: Point,
  extent: number,
  context: TileProjectionContext,
) {
  const nativeWidth = context.tileRectangle.east - context.tileRectangle.west;
  const nativeHeight = context.tileRectangle.north - context.tileRectangle.south;
  const nativeX = context.tileRectangle.west + (point.x / extent) * nativeWidth;
  // 向量瓦片坐标以左上角为原点，y 轴向下增长。
  const nativeY = context.tileRectangle.north - (point.y / extent) * nativeHeight;
  const cartographic = context.projection.unproject(new Cartesian3(nativeX, nativeY, 0));
  return Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    0,
  );
}

export function resolveFeatureId(
  featureId: number | undefined,
  fallbackFeatureId: number,
) {
  return typeof featureId === 'number' ? featureId : fallbackFeatureId;
}
