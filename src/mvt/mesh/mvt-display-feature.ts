import type Point from '@mapbox/point-geometry';
import type {
  MvtBucketFeature,
  MvtLineBucketFeature,
  MvtPointBucketFeature,
  MvtPolygonBucketFeature,
} from '../mvt-types';
import type { MvtOverzoomTransform } from '../tile/mvt-overzoom';
import { mapSourceTilePointToDisplayTilePoint } from '../tile/mvt-overzoom';
import {
  clipTileLineGeometry,
  clipTilePointGeometry,
  clipTilePolygonGeometry,
} from './mvt-tile-clip';

export type MvtDisplayFeatureCache = WeakMap<MvtBucketFeature, MvtBucketFeature | null>;

export function getClippedDisplayFeature(
  feature: MvtBucketFeature,
  extent: number,
  transform: MvtOverzoomTransform,
  cache?: MvtDisplayFeatureCache,
): MvtBucketFeature | undefined {
  const cachedFeature = cache?.get(feature);
  if (cachedFeature !== undefined) {
    return cachedFeature ?? undefined;
  }

  const displayFeature = createDisplayFeature(feature, extent, transform);
  cache?.set(feature, displayFeature ?? null);
  return displayFeature;
}

function createDisplayFeature(
  feature: MvtBucketFeature,
  extent: number,
  transform: MvtOverzoomTransform,
): MvtBucketFeature | undefined {
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
  feature: MvtPointBucketFeature,
  extent: number,
  transform: MvtOverzoomTransform,
): MvtPointBucketFeature | undefined {
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
  feature: MvtLineBucketFeature,
  extent: number,
  transform: MvtOverzoomTransform,
): MvtLineBucketFeature | undefined {
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
  feature: MvtPolygonBucketFeature,
  extent: number,
  transform: MvtOverzoomTransform,
): MvtPolygonBucketFeature | undefined {
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
  transform: MvtOverzoomTransform,
): Point {
  const mappedPoint = mapSourceTilePointToDisplayTilePoint(point, extent, transform);
  return {
    x: mappedPoint.x,
    y: mappedPoint.y,
  } as Point;
}
