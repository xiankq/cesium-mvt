import Point from '@mapbox/point-geometry';

export function getTileUnitsPerPixel(extent: number): number {
  return extent / 512;
}

export function translateTilePoint(
  point: Pick<Point, 'x' | 'y'>,
  extent: number,
  translate: readonly [number, number],
): Point {
  const tileUnitsPerPixel = getTileUnitsPerPixel(extent);
  return new Point(
    point.x + translate[0] * tileUnitsPerPixel,
    point.y + translate[1] * tileUnitsPerPixel,
  );
}

export function translateTilePoints(
  points: readonly Point[],
  extent: number,
  translate: readonly [number, number],
): Point[] {
  if (!translate[0] && !translate[1]) {
    return points.map(point => new Point(point.x, point.y));
  }

  return points.map(point => translateTilePoint(point, extent, translate));
}

export function offsetPolylineInTileSpace(
  points: readonly Point[],
  extent: number,
  offsetPixels: number,
): Point[] {
  if (points.length < 2 || offsetPixels === 0) {
    return points.map(point => new Point(point.x, point.y));
  }

  const offsetInTileUnits = offsetPixels * getTileUnitsPerPixel(extent);
  if (offsetInTileUnits === 0) {
    return points.map(point => new Point(point.x, point.y));
  }

  const segmentNormals: Point[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= 1e-6) {
      segmentNormals.push(new Point(0, 0));
      continue;
    }

    segmentNormals.push(new Point(-deltaY / length, deltaX / length));
  }

  return points.map((point, pointIndex) => {
    const normal = resolveVertexNormal(segmentNormals, pointIndex);
    return new Point(
      point.x + normal.x * offsetInTileUnits,
      point.y + normal.y * offsetInTileUnits,
    );
  });
}

function resolveVertexNormal(segmentNormals: readonly Point[], pointIndex: number): Point {
  if (segmentNormals.length === 0) {
    return new Point(0, 0);
  }
  if (pointIndex <= 0) {
    return segmentNormals[0];
  }
  if (pointIndex >= segmentNormals.length) {
    return segmentNormals[segmentNormals.length - 1];
  }

  const previousNormal = segmentNormals[pointIndex - 1];
  const nextNormal = segmentNormals[pointIndex];
  const sumX = previousNormal.x + nextNormal.x;
  const sumY = previousNormal.y + nextNormal.y;
  const length = Math.hypot(sumX, sumY);
  if (length <= 1e-6) {
    return nextNormal;
  }

  return new Point(sumX / length, sumY / length);
}
