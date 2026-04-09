import Point from '@mapbox/point-geometry';
import { describe, expect, it } from 'vitest';
import { splitPolylineByDashPattern } from '../src/mvt/render/line-dash';

describe('line-dash', () => {
  it('splits tile polylines into visible dash segments', () => {
    const parts = splitPolylineByDashPattern(
      [new Point(0, 0), new Point(10, 0)],
      [1, 1],
      1,
      1,
    );

    expect(parts).toHaveLength(5);
    expect(parts[0][0].x).toBeCloseTo(0);
    expect(parts[0][1].x).toBeCloseTo(1);
    expect(parts[1][0].x).toBeCloseTo(2);
    expect(parts[1][1].x).toBeCloseTo(3);
    expect(parts[4][0].x).toBeCloseTo(8);
    expect(parts[4][1].x).toBeCloseTo(9);
  });
});
