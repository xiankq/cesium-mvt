import type Point from '@mapbox/point-geometry';

export function clipTileLineGeometry(parts: readonly Point[][], extent: number): Point[][] {
  const clippedParts: Point[][] = [];

  for (const part of parts) {
    let currentPart: Point[] = [];
    for (let pointIndex = 1; pointIndex < part.length; pointIndex += 1) {
      const clippedSegment = clipLineSegmentToTile(part[pointIndex - 1], part[pointIndex], extent);
      if (!clippedSegment) {
        if (currentPart.length >= 2) {
          clippedParts.push(currentPart);
        }
        currentPart = [];
        continue;
      }

      const [segmentStart, segmentEnd] = clippedSegment;
      if (!currentPart.length || !arePointsEqual(currentPart.at(-1)!, segmentStart)) {
        currentPart.push(segmentStart);
      }
      if (!arePointsEqual(currentPart.at(-1)!, segmentEnd)) {
        currentPart.push(segmentEnd);
      }
    }

    if (currentPart.length >= 2) {
      clippedParts.push(currentPart);
    }
  }

  return clippedParts;
}

export function clipTilePointGeometry(parts: readonly Point[][], extent: number): Point[][] {
  return parts
    .map(part => part.filter(point => isTilePointInsideExtent(point, extent)))
    .filter(part => part.length > 0);
}

export function clipTilePolygonGeometry(polygons: readonly Point[][][], extent: number): Point[][][] {
  const clippedPolygons: Point[][][] = [];

  for (const polygon of polygons) {
    const clippedRings = polygon
      .map(ring => clipRingToTile(ring, extent))
      .filter((ring): ring is Point[] => ring.length >= 3);

    if (clippedRings.length) {
      clippedPolygons.push(clippedRings);
    }
  }

  return clippedPolygons;
}

export function isTilePointInsideExtent(point: Pick<Point, 'x' | 'y'>, extent: number): boolean {
  return point.x >= 0 && point.x < extent && point.y >= 0 && point.y < extent;
}

function arePointsEqual(left: Pick<Point, 'x' | 'y'>, right: Pick<Point, 'x' | 'y'>): boolean {
  return left.x === right.x && left.y === right.y;
}

function clipLineSegmentToTile(
  start: Point,
  end: Point,
  extent: number,
): [Point, Point] | undefined {
  return clipLineRange(start, end, extent);
}

function clipLineRange(start: Point, end: Point, extent: number): [Point, Point] | undefined {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let minT = 0;
  let maxT = 1;
  const boundaries: Array<[number, number]> = [
    [-deltaX, start.x],
    [deltaX, extent - start.x],
    [-deltaY, start.y],
    [deltaY, extent - start.y],
  ];

  for (const [p, q] of boundaries) {
    if (p === 0) {
      if (q < 0) {
        return undefined;
      }
      continue;
    }

    const ratio = q / p;
    if (p < 0) {
      minT = Math.max(minT, ratio);
    }
    else {
      maxT = Math.min(maxT, ratio);
    }

    if (minT > maxT) {
      return undefined;
    }
  }

  return [
    createTilePoint(start.x + deltaX * minT, start.y + deltaY * minT),
    createTilePoint(start.x + deltaX * maxT, start.y + deltaY * maxT),
  ];
}

function clipRingToTile(ring: readonly Point[], extent: number): Point[] {
  if (!ring.length) {
    return [];
  }

  let clippedRing = removeClosingPoint(ring);
  clippedRing = clipRingAgainstBoundary(clippedRing, point => point.x >= 0, (left, right) => {
    return interpolateVerticalIntersection(left, right, 0);
  });
  clippedRing = clipRingAgainstBoundary(clippedRing, point => point.x <= extent, (left, right) => {
    return interpolateVerticalIntersection(left, right, extent);
  });
  clippedRing = clipRingAgainstBoundary(clippedRing, point => point.y >= 0, (left, right) => {
    return interpolateHorizontalIntersection(left, right, 0);
  });
  clippedRing = clipRingAgainstBoundary(clippedRing, point => point.y <= extent, (left, right) => {
    return interpolateHorizontalIntersection(left, right, extent);
  });
  return clippedRing;
}

function clipRingAgainstBoundary(
  ring: readonly Point[],
  isInside: (point: Point) => boolean,
  intersect: (left: Point, right: Point) => Point,
): Point[] {
  if (!ring.length) {
    return [];
  }

  const clippedRing: Point[] = [];
  let previousPoint = ring[ring.length - 1];
  let previousInside = isInside(previousPoint);

  for (const currentPoint of ring) {
    const currentInside = isInside(currentPoint);
    if (currentInside !== previousInside) {
      clippedRing.push(intersect(previousPoint, currentPoint));
    }
    if (currentInside) {
      clippedRing.push(currentPoint);
    }

    previousPoint = currentPoint;
    previousInside = currentInside;
  }

  return dedupeSequentialPoints(clippedRing);
}

function createTilePoint(x: number, y: number): Point {
  return { x, y } as Point;
}

function dedupeSequentialPoints(points: readonly Point[]): Point[] {
  const dedupedPoints: Point[] = [];
  for (const point of points) {
    if (dedupedPoints.length && arePointsEqual(dedupedPoints.at(-1)!, point)) {
      continue;
    }
    dedupedPoints.push(point);
  }
  return dedupedPoints;
}

function interpolateHorizontalIntersection(start: Point, end: Point, y: number): Point {
  const ratio = start.y === end.y ? 0 : (y - start.y) / (end.y - start.y);
  return createTilePoint(start.x + (end.x - start.x) * ratio, y);
}

function interpolateVerticalIntersection(start: Point, end: Point, x: number): Point {
  const ratio = start.x === end.x ? 0 : (x - start.x) / (end.x - start.x);
  return createTilePoint(x, start.y + (end.y - start.y) * ratio);
}

function removeClosingPoint(ring: readonly Point[]): Point[] {
  if (ring.length < 2) {
    return [...ring];
  }

  const nextRing = [...ring];
  const firstPoint = nextRing[0];
  const lastPoint = nextRing.at(-1)!;
  if (arePointsEqual(firstPoint, lastPoint)) {
    nextRing.pop();
  }
  return nextRing;
}
