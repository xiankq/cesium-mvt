import Point from '@mapbox/point-geometry';

export function splitPolylineByDashPattern(
  points: readonly Point[],
  dashArray: readonly number[] | undefined,
  lineWidth: number,
  tileUnitsPerPixel: number,
): Point[][] {
  if (points.length < 2 || !dashArray?.length || lineWidth <= 0 || tileUnitsPerPixel <= 0) {
    return [points.map(point => new Point(point.x, point.y))];
  }

  const normalizedPattern = normalizeDashPattern(dashArray, lineWidth * tileUnitsPerPixel);
  if (!normalizedPattern.length) {
    return [points.map(point => new Point(point.x, point.y))];
  }

  const renderedParts: Point[][] = [];
  let patternIndex = 0;
  let remainingPatternLength = normalizedPattern[0];
  let drawing = true;
  let currentPart: Point[] = [clonePoint(points[0])];

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    let segmentStart = clonePoint(points[pointIndex - 1]);
    const segmentEnd = points[pointIndex];
    let remainingSegmentLength = distance(segmentStart, segmentEnd);
    if (remainingSegmentLength <= 0) {
      continue;
    }

    while (remainingSegmentLength > 1e-6) {
      const consumedLength = Math.min(remainingSegmentLength, remainingPatternLength);
      const ratio = consumedLength / remainingSegmentLength;
      const nextPoint = interpolatePoint(segmentStart, segmentEnd, ratio);

      if (drawing) {
        if (!currentPart.length) {
          currentPart.push(clonePoint(segmentStart));
        }
        currentPart.push(nextPoint);
      }

      remainingSegmentLength -= consumedLength;
      remainingPatternLength -= consumedLength;
      segmentStart = nextPoint;

      if (remainingPatternLength > 1e-6) {
        continue;
      }

      if (drawing && currentPart.length >= 2) {
        renderedParts.push(currentPart);
      }

      patternIndex = (patternIndex + 1) % normalizedPattern.length;
      remainingPatternLength = normalizedPattern[patternIndex];
      drawing = !drawing;
      currentPart = drawing ? [clonePoint(segmentStart)] : [];
    }
  }

  if (drawing && currentPart.length >= 2) {
    renderedParts.push(currentPart);
  }

  return renderedParts.length
    ? renderedParts
    : [points.map(point => new Point(point.x, point.y))];
}

function clonePoint(point: Pick<Point, 'x' | 'y'>): Point {
  return new Point(point.x, point.y);
}

function distance(start: Pick<Point, 'x' | 'y'>, end: Pick<Point, 'x' | 'y'>): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return Math.hypot(deltaX, deltaY);
}

function interpolatePoint(
  start: Pick<Point, 'x' | 'y'>,
  end: Pick<Point, 'x' | 'y'>,
  ratio: number,
): Point {
  return new Point(
    start.x + (end.x - start.x) * ratio,
    start.y + (end.y - start.y) * ratio,
  );
}

function normalizeDashPattern(
  dashArray: readonly number[],
  tilePatternUnit: number,
): number[] {
  const scaledPattern = dashArray
    .map(item => item * tilePatternUnit)
    .filter(item => Number.isFinite(item) && item > 1e-6);
  if (!scaledPattern.length) {
    return [];
  }

  return scaledPattern.length % 2 === 0
    ? scaledPattern
    : [...scaledPattern, ...scaledPattern];
}
