import type Point from '@mapbox/point-geometry';
import type { OverzoomTransform } from '../tile/overzoom';
import type { BucketFeature, LineBucketFeature, PointBucketFeature, PolygonBucketFeature } from '../types';
import { mapSourceTilePointToDisplayTilePoint } from '../tile/overzoom';
import { clipTileLineGeometry, clipTilePointGeometry, clipTilePolygonGeometry } from './tile-clip';

export type DisplayFeatureCache = WeakMap<BucketFeature, BucketFeature | null>;

export function getClippedDisplayFeature(
  feature: BucketFeature,
  extent: number,
  transform: OverzoomTransform,
  cache?: DisplayFeatureCache,
): BucketFeature | undefined {
  const cachedFeature = cache?.get(feature);
  if (cachedFeature !== undefined) {
    return cachedFeature ?? undefined;
  }

  const displayFeature = createDisplayFeature(feature, extent, transform);
  cache?.set(feature, displayFeature ?? null);
  return displayFeature;
}

function createDisplayFeature(
  feature: BucketFeature,
  extent: number,
  transform: OverzoomTransform,
): BucketFeature | undefined {
  switch (feature.geometryType) {
    case 'Point':
      return createDisplayPointFeature(feature, extent, transform);
    case 'LineString':
      return createDisplayLineFeature(feature, extent, transform);
    case 'Polygon':
      return createDisplayPolygonFeature(feature, extent, transform);
  }
}

function createDisplayPointFeature(
  feature: PointBucketFeature,
  extent: number,
  transform: OverzoomTransform,
): PointBucketFeature | undefined {
  const geometry = clipTilePointGeometry(
    feature.geometry.map(part => part.map(point => mapPointToDisplayTile(point, extent, transform))),
    extent,
  );
  if (!geometry.length) {
    return undefined;
  }

  return {
    ...feature,
    geometry,
  };
}

function createDisplayLineFeature(
  feature: LineBucketFeature,
  extent: number,
  transform: OverzoomTransform,
): LineBucketFeature | undefined {
  const geometry = clipTileLineGeometry(
    feature.geometry.map(part => part.map(point => mapPointToDisplayTile(point, extent, transform))),
    extent,
  );
  if (!geometry.length) {
    return undefined;
  }

  return {
    ...feature,
    geometry,
  };
}

function createDisplayPolygonFeature(
  feature: PolygonBucketFeature,
  extent: number,
  transform: OverzoomTransform,
): PolygonBucketFeature | undefined {
  const geometry = clipTilePolygonGeometry(
    feature.geometry.map((polygon) => {
      return polygon.map(ring => ring.map(point => mapPointToDisplayTile(point, extent, transform)));
    }),
    extent,
  );
  if (!geometry.length) {
    return undefined;
  }

  return {
    ...feature,
    geometry,
  };
}

function mapPointToDisplayTile(
  point: Pick<Point, 'x' | 'y'>,
  extent: number,
  transform: OverzoomTransform,
): Point {
  const mappedPoint = mapSourceTilePointToDisplayTilePoint(point, extent, transform);
  return {
    x: mappedPoint.x,
    y: mappedPoint.y,
  } as Point;
}
