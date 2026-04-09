import type {
  Rectangle,
  TilingScheme,
  WebMercatorProjection,
} from 'cesium';
import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Ellipsoid,
} from 'cesium';

export interface TileProjectionContext {
  level: number;
  x: number;
  y: number;
  projection: WebMercatorProjection;
  tileRectangle: Rectangle;
}

export function createTileProjectionContext(
  level: number,
  x: number,
  y: number,
  tilingScheme: TilingScheme,
): TileProjectionContext {
  const tileRectangle = tilingScheme.tileXYToRectangle(x, y, level);
  const projection = tilingScheme.projection as WebMercatorProjection;

  return {
    level,
    x,
    y,
    projection,
    tileRectangle,
  };
}

export function projectTilePoint(
  point: { x: number; y: number },
  extent: number,
  context: TileProjectionContext,
): Cartesian3 {
  const { tileRectangle } = context;

  const u = CesiumMath.clamp(point.x / extent, 0, 1);
  const v = CesiumMath.clamp(point.y / extent, 0, 1);

  const longitude = CesiumMath.lerp(tileRectangle.west, tileRectangle.east, u);
  const latitude = CesiumMath.lerp(tileRectangle.south, tileRectangle.north, 1 - v);

  const cartographic = new Cartographic(longitude, latitude, 0);
  return Ellipsoid.WGS84.cartographicToCartesian(cartographic, new Cartesian3());
}
