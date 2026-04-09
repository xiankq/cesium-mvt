import type Point from '@mapbox/point-geometry';
import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer } from '../types';
import type { SymbolAnchor } from './symbol-types';
import type { createTileTransform } from './tile-transform';
import { normalizePolylinePoints } from '../mesh/geometry-normalize';
import { createPoint } from '../utils/point-utils';
import { TILE_PIXEL_SIZE } from './constants';
import { getTileUnitsPerPixel } from './style-geometry';
import { projectTilePointToLocalCartesian } from './tile-transform';

export function resolveSymbolAnchors(
  styleSet: StyleSet,
  feature: BucketFeature,
  extent: number,
  layer: CompiledStyleLayer,
  transform: ReturnType<typeof createTileTransform>,
  zoom: number,
): SymbolAnchor[] {
  const placement = styleSet.evaluateLayoutValue(layer, 'symbol-placement', zoom, feature);
  const isLinePlacement = placement === 'line';
  const spacing = resolveSymbolSpacing(styleSet, layer, zoom, feature, extent);

  switch (feature.geometryType) {
    case 'Point':
      return feature.geometry.flat().map(point => createSymbolAnchor(point, 0, extent, transform));
    case 'LineString':
      return feature.geometry
        .flatMap((part) => {
          const normalizedPart = normalizePolylinePoints(part);
          if (isLinePlacement) {
            return sampleLineAnchors(normalizedPart, spacing);
          }

          const midpoint = resolveLineMidpoint(normalizedPart);
          return midpoint ? [{ angle: 0, point: midpoint }] : [];
        })
        .map(anchor => createSymbolAnchor(anchor.point, anchor.angle, extent, transform));
    case 'Polygon':
      if (isLinePlacement) {
        return feature.geometry
          .flatMap(polygon => sampleLineAnchors(normalizePolylinePoints(polygon[0] ?? []), spacing))
          .map(anchor => createSymbolAnchor(anchor.point, anchor.angle, extent, transform));
      }

      return feature.geometry
        .map(polygon => resolvePolygonAnchorPoint(polygon[0] ?? []))
        .filter((point): point is Point => Boolean(point))
        .map(point => createSymbolAnchor(point, 0, extent, transform));
  }
}

export function createSymbolAnchor(
  point: Point,
  angle: number,
  extent: number,
  transform: ReturnType<typeof createTileTransform>,
): SymbolAnchor {
  const zoomScale = 2 ** transform.displayCoordinate.z;
  const mapScale = 1 / (TILE_PIXEL_SIZE * zoomScale);

  return {
    angle,
    mapScale,
    mapX: (transform.displayCoordinate.x + point.x / extent) / zoomScale,
    mapY: (transform.displayCoordinate.y + point.y / extent) / zoomScale,
    position: projectTilePointToLocalCartesian(point, extent, transform),
  };
}

function resolveSymbolSpacing(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature: BucketFeature,
  extent: number,
): number {
  return Math.max(1, styleSet.evaluateLayoutNumber(layer, 'symbol-spacing', zoom, feature, 250))
    * getTileUnitsPerPixel(extent);
}

function resolveLineMidpoint(points: readonly Point[]): Point | undefined {
  if (points.length === 0) {
    return undefined;
  }
  if (points.length === 1) {
    return points[0];
  }

  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength <= 0) {
    return points[Math.floor(points.length / 2)];
  }

  const halfLength = totalLength * 0.5;
  let accumulatedLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = segmentLengths[index - 1];
    if (accumulatedLength + segmentLength < halfLength) {
      accumulatedLength += segmentLength;
      continue;
    }

    const ratio = segmentLength <= 0 ? 0 : (halfLength - accumulatedLength) / segmentLength;
    const start = points[index - 1];
    const end = points[index];
    return createPoint(
      start.x + (end.x - start.x) * ratio,
      start.y + (end.y - start.y) * ratio,
    );
  }

  return points[points.length - 1];
}

function resolvePolygonAnchorPoint(ring: readonly Point[]): Point | undefined {
  if (!ring.length) {
    return undefined;
  }

  let minX = ring[0].x;
  let minY = ring[0].y;
  let maxX = ring[0].x;
  let maxY = ring[0].y;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return createPoint((minX + maxX) * 0.5, (minY + maxY) * 0.5);
}

function sampleLineAnchors(
  points: readonly Point[],
  spacing: number,
): Array<{ angle: number; point: Point }> {
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [{ angle: 0, point: points[0] }];
  }

  const totalLength = computePolylineLength(points);
  if (totalLength <= 0) {
    return [{ angle: 0, point: points[Math.floor(points.length / 2)] }];
  }

  const anchors: Array<{ angle: number; point: Point }> = [];
  const normalizedSpacing = Math.max(1, spacing);
  let targetDistance = normalizedSpacing * 0.5;

  while (targetDistance < totalLength) {
    const anchor = interpolateLineAnchor(points, targetDistance);
    if (anchor) {
      anchors.push(anchor);
    }
    targetDistance += normalizedSpacing;
  }

  if (anchors.length) {
    return anchors;
  }

  const midpoint = resolveLineMidpoint(points);
  return midpoint ? [{ angle: 0, point: midpoint }] : [];
}

function computePolylineLength(points: readonly Point[]): number {
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    totalLength += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return totalLength;
}

function interpolateLineAnchor(
  points: readonly Point[],
  targetDistance: number,
): { angle: number; point: Point } | undefined {
  let accumulatedLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);

    if (accumulatedLength + segmentLength < targetDistance) {
      accumulatedLength += segmentLength;
      continue;
    }

    const ratio = segmentLength <= 0 ? 0 : (targetDistance - accumulatedLength) / segmentLength;
    return {
      angle: Math.atan2(-(end.y - start.y), end.x - start.x),
      point: createPoint(
        start.x + (end.x - start.x) * ratio,
        start.y + (end.y - start.y) * ratio,
      ),
    };
  }

  return undefined;
}
