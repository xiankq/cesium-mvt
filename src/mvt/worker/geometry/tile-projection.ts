import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Ellipsoid,
} from 'cesium';

export interface TileProjectionData {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface TileProjectionContext {
  tileRectangle: TileProjectionData;
}

export function createTileProjectionData(
  level: number,
  x: number,
  y: number,
  tileXYToRectangle: (x: number, y: number, level: number) => { west: number; south: number; east: number; north: number },
): TileProjectionData {
  const rect = tileXYToRectangle(x, y, level);
  return {
    east: rect.east,
    north: rect.north,
    south: rect.south,
    west: rect.west,
  };
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

  const u = CesiumMath.clamp(point.x / extent, 0, 1);
  const v = CesiumMath.clamp(point.y / extent, 0, 1);

  const longitude = CesiumMath.lerp(tileRectangle.west, tileRectangle.east, u);
  const latitude = CesiumMath.lerp(tileRectangle.south, tileRectangle.north, 1 - v);

  if (!isValidNumber(longitude) || !isValidNumber(latitude)) {
    return new Cartesian3(0, 0, 0);
  }

  const cartographic = new Cartographic(longitude, latitude, 0);
  return Ellipsoid.WGS84.cartographicToCartesian(cartographic, new Cartesian3());
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
