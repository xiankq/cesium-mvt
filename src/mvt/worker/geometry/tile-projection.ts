import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Ellipsoid,
} from 'cesium';
import { isValidNumber } from './utils';

export interface TileProjectionData {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface TileProjectionContext {
  tileRectangle: TileProjectionData;
}

export function createTileProjectionContext(
  data: TileProjectionData,
): TileProjectionContext {
  return {
    tileRectangle: data,
  };
}

export function projectTilePoint(
  point: { x: number; y: number },
  extent: number,
  context: TileProjectionContext,
): Cartesian3 {
  const { tileRectangle } = context;

  if (!isValidNumber(tileRectangle.west) || !isValidNumber(tileRectangle.south)
    || !isValidNumber(tileRectangle.east) || !isValidNumber(tileRectangle.north)) {
    return new Cartesian3(0, 0, 0);
  }

  const u = point.x / extent;
  const v = point.y / extent;

  const longitude = CesiumMath.lerp(tileRectangle.west, tileRectangle.east, u);
  const latitude = CesiumMath.lerp(tileRectangle.south, tileRectangle.north, 1 - v);

  if (!isValidNumber(longitude) || !isValidNumber(latitude)) {
    return new Cartesian3(0, 0, 0);
  }

  const cartographic = new Cartographic(longitude, latitude, 0);
  return Ellipsoid.WGS84.cartographicToCartesian(cartographic, new Cartesian3());
}
