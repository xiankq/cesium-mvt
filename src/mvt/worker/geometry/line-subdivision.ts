import { Cartesian3, Ellipsoid } from 'cesium';

export function subdivideLine(
  start: Cartesian3,
  end: Cartesian3,
  maxChordError: number,
): Cartesian3[] {
  if (Cartesian3.equals(start, end)) {
    return [start];
  }

  const distance = Cartesian3.distance(start, end);

  if (distance < maxChordError * 2) {
    return [start, end];
  }

  const ellipsoidMaximumRadius = Ellipsoid.WGS84.maximumRadius;

  const chordErrorRatio = maxChordError / ellipsoidMaximumRadius;
  const subdivisionAngle = 2 * Math.acos(1 - chordErrorRatio);
  const subdivisions = Math.ceil(Math.PI / subdivisionAngle);

  const actualSubdivisions = Math.max(2, Math.min(subdivisions, Math.floor(distance / maxChordError)));

  if (actualSubdivisions <= 1) {
    return [start, end];
  }

  const points: Cartesian3[] = [start];
  for (let i = 1; i < actualSubdivisions; i++) {
    const t = i / actualSubdivisions;
    const point = Cartesian3.lerp(start, end, t, new Cartesian3());
    const normalized = Cartesian3.normalize(point, new Cartesian3());
    const scaled = Cartesian3.multiplyByScalar(
      normalized,
      Ellipsoid.WGS84.maximumRadius,
      new Cartesian3(),
    );
    points.push(scaled);
  }
  points.push(end);

  return points;
}

export function subdivideRing(
  ring: Cartesian3[],
  maxChordError: number,
): Cartesian3[] {
  if (ring.length < 2) {
    return ring;
  }

  const subdivided: Cartesian3[] = [];

  for (let i = 0; i < ring.length - 1; i++) {
    const segment = subdivideLine(ring[i], ring[i + 1], maxChordError);
    subdivided.push(...segment.slice(0, -1));
  }

  subdivided.push(ring[ring.length - 1]);

  return subdivided;
}
