import type Point from '@mapbox/point-geometry';
import type { MvtTileCoordinate } from '../mvt-types';

export interface MvtOverzoomTransform {
  coordinateScale: number;
  displayCoordinate: MvtTileCoordinate;
  sourceCoordinate: MvtTileCoordinate;
  tileOffsetX: number;
  tileOffsetY: number;
}

export function createMvtOverzoomTransform(
  displayCoordinate: MvtTileCoordinate,
  sourceCoordinate: MvtTileCoordinate = displayCoordinate,
): MvtOverzoomTransform {
  const zoomDelta = displayCoordinate.z - sourceCoordinate.z;
  if (zoomDelta <= 0) {
    return {
      coordinateScale: 1,
      displayCoordinate,
      sourceCoordinate,
      tileOffsetX: 0,
      tileOffsetY: 0,
    };
  }

  const coordinateScale = 2 ** zoomDelta;
  return {
    coordinateScale,
    displayCoordinate,
    sourceCoordinate,
    tileOffsetX: displayCoordinate.x - sourceCoordinate.x * coordinateScale,
    tileOffsetY: displayCoordinate.y - sourceCoordinate.y * coordinateScale,
  };
}

export function getMvtSourceTileCoordinate(
  displayCoordinate: MvtTileCoordinate,
  sourceMaxzoom?: number,
): MvtTileCoordinate {
  if (sourceMaxzoom === undefined || displayCoordinate.z <= sourceMaxzoom) {
    return { ...displayCoordinate };
  }

  const zoomDelta = displayCoordinate.z - sourceMaxzoom;
  return {
    x: Math.floor(displayCoordinate.x / 2 ** zoomDelta),
    y: Math.floor(displayCoordinate.y / 2 ** zoomDelta),
    z: sourceMaxzoom,
  };
}

export function mapSourceTilePointToDisplayTilePoint(
  point: Pick<Point, 'x' | 'y'>,
  extent: number,
  transform: MvtOverzoomTransform,
): { x: number; y: number } {
  if (transform.coordinateScale === 1) {
    return {
      x: point.x,
      y: point.y,
    };
  }

  return {
    x: point.x * transform.coordinateScale - transform.tileOffsetX * extent,
    y: point.y * transform.coordinateScale - transform.tileOffsetY * extent,
  };
}
