import type Point from '@mapbox/point-geometry';

export function normalizePolylinePoints(points: readonly Point[]): Point[] {
  const normalizedPoints: Point[] = [];
  for (const point of points) {
    const previousPoint = normalizedPoints.at(-1);
    if (previousPoint?.x === point.x && previousPoint.y === point.y) {
      continue;
    }
    normalizedPoints.push(point);
  }

  return normalizedPoints;
}

export function normalizeRingPoints(points: readonly Point[]): Point[] {
  const normalizedPoints = normalizePolylinePoints(points);
  if (normalizedPoints.length >= 2) {
    const firstPoint = normalizedPoints[0];
    const lastPoint = normalizedPoints.at(-1)!;
    if (firstPoint.x === lastPoint.x && firstPoint.y === lastPoint.y) {
      normalizedPoints.pop();
    }
  }

  return normalizedPoints;
}
