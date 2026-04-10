import type { Cartesian3 } from 'cesium';
import { DEFAULT_EXTENT } from './utils';

const BOUNDARY_SNAP_THRESHOLD = 0.5; // 边界点吸附阈值，用于将接近边界的点吸附到边界上，避免因浮点误差导致的裂缝
const KEY_PRECISION = 100; // 缓存键精度，用于将浮点坐标转换为整数键，100 表示保留两位小数精度

export interface TilePoint {
  x: number;
  y: number;
}

export interface SubdividedMesh {
  positions: Cartesian3[];
  triangles: number[];
}

function snapBoundaryPoint(value: number): number {
  if (Math.abs(value) < BOUNDARY_SNAP_THRESHOLD) {
    return 0;
  }
  if (Math.abs(value - DEFAULT_EXTENT) < BOUNDARY_SNAP_THRESHOLD) {
    return DEFAULT_EXTENT;
  }
  return value;
}

function subdivideEdgeOnGrid(
  start: TilePoint,
  end: TilePoint,
  gridCellSize: number,
): TilePoint[] {
  const snappedStart: TilePoint = {
    x: snapBoundaryPoint(start.x),
    y: snapBoundaryPoint(start.y),
  };
  const snappedEnd: TilePoint = {
    x: snapBoundaryPoint(end.x),
    y: snapBoundaryPoint(end.y),
  };

  const dx = snappedEnd.x - snappedStart.x;
  const dy = snappedEnd.y - snappedStart.y;

  if (dx === 0 && dy === 0) {
    return [snappedStart];
  }

  const xIntersections: number[] = [];
  const yIntersections: number[] = [];

  if (dx !== 0) {
    const startX = Math.floor(snappedStart.x / gridCellSize) * gridCellSize;
    const stepX = dx > 0 ? gridCellSize : -gridCellSize;
    let x = startX + (dx > 0 ? gridCellSize : 0);

    if (dx > 0) {
      while (x < snappedEnd.x) {
        if (x !== snappedStart.x) {
          xIntersections.push(x);
        }
        x += stepX;
      }
    }
    else {
      while (x > snappedEnd.x) {
        if (x !== snappedStart.x) {
          xIntersections.push(x);
        }
        x += stepX;
      }
    }
  }

  if (dy !== 0) {
    const startY = Math.floor(snappedStart.y / gridCellSize) * gridCellSize;
    const stepY = dy > 0 ? gridCellSize : -gridCellSize;
    let y = startY + (dy > 0 ? gridCellSize : 0);

    if (dy > 0) {
      while (y < snappedEnd.y) {
        if (y !== snappedStart.y) {
          yIntersections.push(y);
        }
        y += stepY;
      }
    }
    else {
      while (y > snappedEnd.y) {
        if (y !== snappedStart.y) {
          yIntersections.push(y);
        }
        y += stepY;
      }
    }
  }

  const intersectionPoints: { t: number; point: TilePoint }[] = [];

  for (const x of xIntersections) {
    const t = (x - snappedStart.x) / dx;
    const y = snappedStart.y + t * dy;
    intersectionPoints.push({ t, point: { x, y } });
  }

  for (const y of yIntersections) {
    const t = (y - snappedStart.y) / dy;
    const x = snappedStart.x + t * dx;
    intersectionPoints.push({ t, point: { x, y } });
  }

  intersectionPoints.sort((a, b) => a.t - b.t);

  const uniquePoints: TilePoint[] = [];
  for (const ip of intersectionPoints) {
    if (uniquePoints.length === 0) {
      uniquePoints.push(ip.point);
    }
    else {
      const last = uniquePoints[uniquePoints.length - 1];
      const dist = Math.sqrt((ip.point.x - last.x) ** 2 + (ip.point.y - last.y) ** 2);
      if (dist > 0.001) {
        uniquePoints.push(ip.point);
      }
    }
  }

  const points: TilePoint[] = [snappedStart];
  points.push(...uniquePoints);
  points.push(snappedEnd);

  return points;
}

export function subdivideTriangleEdges(
  tilePoints: TilePoint[],
  triangles: number[],
  granularity: number,
  projectPoint: (point: TilePoint) => Cartesian3,
): SubdividedMesh {
  if (tilePoints.length === 0 || triangles.length === 0) {
    return { positions: [], triangles: [] };
  }

  const gridCellSize = DEFAULT_EXTENT / granularity;
  const snappedTilePoints: TilePoint[] = tilePoints.map(p => ({
    x: snapBoundaryPoint(p.x),
    y: snapBoundaryPoint(p.y),
  }));
  const edgeCache = new Map<string, TilePoint[]>();

  const KEY_MULTIPLIER = 409601;

  function createPointKey(x: number, y: number): number {
    const ix = Math.round(x * KEY_PRECISION);
    const iy = Math.round(y * KEY_PRECISION);
    return ix * KEY_MULTIPLIER + iy;
  }

  function createEdgeKey(p0: TilePoint, p1: TilePoint): string {
    const k0 = createPointKey(p0.x, p0.y);
    const k1 = createPointKey(p1.x, p1.y);
    return `${k0}->${k1}`;
  }

  function getSubdividedEdgeByPoints(p0: TilePoint, p1: TilePoint): TilePoint[] {
    const key = createEdgeKey(p0, p1);
    let edge = edgeCache.get(key);
    if (!edge) {
      edge = subdivideEdgeOnGrid(p0, p1, gridCellSize);
      edgeCache.set(key, edge);
      const reverseKey = createEdgeKey(p1, p0);
      edgeCache.set(reverseKey, [...edge].reverse());
    }
    return edge;
  }

  const allPositions: Cartesian3[] = [];
  const allTriangles: number[] = [];
  const pointIndexMap = new Map<number, number>();

  function getOrAddPoint(point: TilePoint): number {
    const key = createPointKey(point.x, point.y);
    let index = pointIndexMap.get(key);
    if (index === undefined) {
      index = allPositions.length;
      allPositions.push(projectPoint(point));
      pointIndexMap.set(key, index);
    }
    return index;
  }

  function subdivideTriangleRecursive(p0: TilePoint, p1: TilePoint, p2: TilePoint, depth: number): void {
    const MAX_DEPTH = 20;

    if (depth >= MAX_DEPTH) {
      allTriangles.push(getOrAddPoint(p0), getOrAddPoint(p1), getOrAddPoint(p2));
      return;
    }

    const edge01 = getSubdividedEdgeByPoints(p0, p1);
    const edge12 = getSubdividedEdgeByPoints(p1, p2);
    const edge20 = getSubdividedEdgeByPoints(p2, p0);

    const hasSubdivision = edge01.length > 2 || edge12.length > 2 || edge20.length > 2;

    if (!hasSubdivision) {
      allTriangles.push(getOrAddPoint(p0), getOrAddPoint(p1), getOrAddPoint(p2));
      return;
    }

    const d01 = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
    const d12 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    const d20 = Math.sqrt((p0.x - p2.x) ** 2 + (p0.y - p2.y) ** 2);

    let longestEdge: TilePoint[];
    let midPoint: TilePoint;
    let a1: TilePoint, b1: TilePoint, a2: TilePoint, b2: TilePoint;

    if (d01 >= d12 && d01 >= d20) {
      longestEdge = edge01;
      const midIndex = Math.floor(longestEdge.length / 2);
      midPoint = longestEdge[midIndex];
      a1 = p0;
      b1 = midPoint;
      a2 = midPoint;
      b2 = p1;
      subdivideTriangleRecursive(a1, b1, p2, depth + 1);
      subdivideTriangleRecursive(a2, b2, p2, depth + 1);
    }
    else if (d12 >= d01 && d12 >= d20) {
      longestEdge = edge12;
      const midIndex = Math.floor(longestEdge.length / 2);
      midPoint = longestEdge[midIndex];
      a1 = p1;
      b1 = midPoint;
      a2 = midPoint;
      b2 = p2;
      subdivideTriangleRecursive(a1, b1, p0, depth + 1);
      subdivideTriangleRecursive(a2, b2, p0, depth + 1);
    }
    else {
      longestEdge = edge20;
      const midIndex = Math.floor(longestEdge.length / 2);
      midPoint = longestEdge[midIndex];
      a1 = p2;
      b1 = midPoint;
      a2 = midPoint;
      b2 = p0;
      subdivideTriangleRecursive(a1, b1, p1, depth + 1);
      subdivideTriangleRecursive(a2, b2, p1, depth + 1);
    }
  }

  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i];
    const i1 = triangles[i + 1];
    const i2 = triangles[i + 2];

    const p0 = snappedTilePoints[i0];
    const p1 = snappedTilePoints[i1];
    const p2 = snappedTilePoints[i2];

    subdivideTriangleRecursive(p0, p1, p2, 0);
  }

  return {
    positions: allPositions,
    triangles: allTriangles,
  };
}

export function getGranularityForZoomLevel(
  zoom: number,
  baseGranularity: number = 128,
  minGranularity: number = 1,
): number {
  const granularity = baseGranularity / 2 ** zoom;
  return Math.max(minGranularity, Math.min(baseGranularity, granularity));
}

export function getGridCellSize(granularity: number): number {
  return DEFAULT_EXTENT / granularity;
}
