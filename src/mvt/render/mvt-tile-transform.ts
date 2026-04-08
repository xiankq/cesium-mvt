import type {
  TilingScheme,
} from '@cesium/engine';
import type Point from '@mapbox/point-geometry';
import type { MvtTileCoordinate } from '../mvt-types';
import {
  BoundingSphere,
  Cartesian3,
  Ellipsoid,
  Matrix4,
  Rectangle,
  Transforms,
} from '@cesium/engine';
import {
  createMvtOverzoomTransform,
  mapSourceTilePointToDisplayTilePoint,
} from '../tile/mvt-overzoom';

const scratchRectangle = new Rectangle();
const scratchWorldPosition = new Cartesian3();

export interface MvtTileTransform {
  boundingSphere: BoundingSphere;
  coordinateScale: number;
  displayCoordinate: MvtTileCoordinate;
  inverseModelMatrix: Matrix4;
  modelMatrix: Matrix4;
  rectangle: Rectangle;
  sourceCoordinate: MvtTileCoordinate;
  tileOffsetX: number;
  tileOffsetY: number;
}

export function createMvtTileTransform(
  tilingScheme: TilingScheme,
  displayCoordinate: MvtTileCoordinate,
  sourceCoordinate: MvtTileCoordinate = displayCoordinate,
): MvtTileTransform {
  const overzoomTransform = createMvtOverzoomTransform(displayCoordinate, sourceCoordinate);
  const rectangle = tilingScheme.tileXYToRectangle(
    displayCoordinate.x,
    displayCoordinate.y,
    displayCoordinate.z,
    scratchRectangle,
  );
  const centerLongitude = (rectangle.west + rectangle.east) * 0.5;
  const centerLatitude = (rectangle.south + rectangle.north) * 0.5;
  const center = Cartesian3.fromRadians(centerLongitude, centerLatitude, 0, Ellipsoid.default);
  const modelMatrix = Transforms.eastNorthUpToFixedFrame(center);
  const inverseModelMatrix = Matrix4.inverseTransformation(modelMatrix, new Matrix4());
  const corners = [
    Cartesian3.fromRadians(rectangle.west, rectangle.south),
    Cartesian3.fromRadians(rectangle.west, rectangle.north),
    Cartesian3.fromRadians(rectangle.east, rectangle.south),
    Cartesian3.fromRadians(rectangle.east, rectangle.north),
  ];

  return {
    boundingSphere: BoundingSphere.fromPoints(corners),
    coordinateScale: overzoomTransform.coordinateScale,
    displayCoordinate,
    inverseModelMatrix,
    modelMatrix,
    rectangle: Rectangle.clone(rectangle),
    sourceCoordinate,
    tileOffsetX: overzoomTransform.tileOffsetX,
    tileOffsetY: overzoomTransform.tileOffsetY,
  };
}

export function projectTilePointToLocalCartesian(
  point: Point,
  extent: number,
  transform: MvtTileTransform,
  result = new Cartesian3(),
): Cartesian3 {
  const mappedPoint = mapSourceTilePointToDisplayTilePoint(point, extent, transform);
  const u = mappedPoint.x / extent;
  const v = mappedPoint.y / extent;
  const longitude = transform.rectangle.west + (transform.rectangle.east - transform.rectangle.west) * u;
  const latitude = transform.rectangle.north + (transform.rectangle.south - transform.rectangle.north) * v;
  Cartesian3.fromRadians(longitude, latitude, 0, Ellipsoid.default, scratchWorldPosition);
  return Matrix4.multiplyByPoint(transform.inverseModelMatrix, scratchWorldPosition, result);
}
