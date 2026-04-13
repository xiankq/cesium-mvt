import type { Camera } from 'cesium';
import type { TileCoordinate } from './tile-request';
import {
  BoundingSphere,
  Cartesian3,
} from 'cesium';

export interface SourceConstraints {
  maxZoom?: number;
  minZoom?: number;
}

export interface TileVisibilityContext {
  cameraPosition: Cartesian3;
  cullingVolume: {
    computeVisibility: (boundingVolume: any) => number;
  };
  distanceThreshold: number;
  horizonDistance: number;
}

export interface CreateTileVisibilityContextOptions {
  camera: Camera;
  viewportHeight: number;
  viewportWidth: number;
}

export interface ComputeTileVisibilityOptions {
  boundingSphereCenter: Cartesian3;
  boundingSphereRadius: number;
  context: TileVisibilityContext;
  tileLevel: number;
}

export interface ShouldRequestTileOptions {
  coordinate: TileCoordinate;
  isCached: boolean;
  isPending: boolean;
  sourceConstraints: SourceConstraints;
}

export interface ShouldRenderTileOptions {
  coordinate: TileCoordinate;
  hasData: boolean;
  sourceConstraints: SourceConstraints;
}

const OUTSIDE = -1;
const EARTH_RADIUS = 6378137;

export function isTileVisibleAtZoom(
  zoom: number,
  constraints: SourceConstraints,
): boolean {
  const { maxZoom, minZoom } = constraints;
  const effectiveMinZoom = minZoom ?? Number.NEGATIVE_INFINITY;
  const effectiveMaxZoom = maxZoom ?? Number.POSITIVE_INFINITY;

  return zoom >= effectiveMinZoom && zoom < effectiveMaxZoom;
}

export function shouldRequestTile(options: ShouldRequestTileOptions): boolean {
  const { coordinate, isCached, isPending, sourceConstraints } = options;

  if (isCached || isPending) {
    return false;
  }

  return isTileVisibleAtZoom(coordinate.level, sourceConstraints);
}

export function shouldRenderTile(options: ShouldRenderTileOptions): boolean {
  const { coordinate, hasData, sourceConstraints } = options;

  if (!hasData) {
    return false;
  }

  const { minZoom } = sourceConstraints;
  if (minZoom !== undefined && coordinate.level < minZoom) {
    return false;
  }

  return true;
}

export function computeTileVisibility(
  options: ComputeTileVisibilityOptions,
): 'hidden' | 'visible' {
  const { boundingSphereCenter, boundingSphereRadius, context } = options;

  const boundingSphere = new BoundingSphere(
    boundingSphereCenter,
    boundingSphereRadius,
  );

  const visibility = context.cullingVolume.computeVisibility(boundingSphere);
  if (visibility === OUTSIDE) {
    return 'hidden';
  }

  const distance = Cartesian3.distance(
    context.cameraPosition,
    boundingSphereCenter,
  );

  if (distance - boundingSphereRadius > context.horizonDistance) {
    return 'hidden';
  }

  return 'visible';
}

export function createTileVisibilityContext(
  options: CreateTileVisibilityContextOptions,
): TileVisibilityContext {
  const { camera, viewportHeight, viewportWidth } = options;

  const cameraPosition = Cartesian3.clone(camera.position);

  const cullingVolume = camera.frustum?.computeCullingVolume?.(
    cameraPosition,
    camera.direction,
    camera.up,
  ) ?? {
    computeVisibility: () => 1,
  };

  const heightAboveEllipsoid = Cartesian3.magnitude(cameraPosition) - EARTH_RADIUS;
  const horizonDistance = Math.sqrt(
    2 * EARTH_RADIUS * heightAboveEllipsoid + heightAboveEllipsoid * heightAboveEllipsoid,
  );

  const distanceThreshold = Math.max(
    viewportWidth,
    viewportHeight,
  ) * 0.5;

  return {
    cameraPosition,
    cullingVolume,
    distanceThreshold,
    horizonDistance,
  };
}
