import type { Cartesian3 } from 'cesium';
import { DEFAULT_EXTENT } from './utils';

/**
 * 三角形网格细分算法
 *
 * 该模块实现了在网格上细分三角形边的算法，用于解决相邻三角形共享边时的裂缝问题。
 * 算法核心思想：
 * 1. 将三角形边与网格线求交，生成细分点
 * 2. 使用边缓存确保相邻三角形共享边时生成相同的细分点
 * 3. 通过递归细分处理复杂情况
 */

/**
 * 边界点吸附阈值
 *
 * 用于将接近边界的点吸附到边界上，避免因浮点误差导致的裂缝
 * 当点距离边界小于此阈值时，会被吸附到边界上
 */
const BOUNDARY_SNAP_THRESHOLD = 0.5;

/**
 * 缓存键精度
 *
 * 用于将浮点坐标转换为整数键，100 表示保留两位小数精度
 * 这个精度足够捕捉网格细分中的关键点
 */
const KEY_PRECISION = 100;

/**
 * 点键乘数
 *
 * 用于生成唯一的点键，409601 是一个质数，可以减少哈希冲突
 */
const KEY_MULTIPLIER = 409601;

/**
 * 最大递归深度
 *
 * 限制递归细分的深度，防止无限递归
 */
const MAX_RECURSION_DEPTH = 20;

/**
 * 瓦片坐标系中的点
 */
export interface TilePoint {
  x: number;
  y: number;
}

/**
 * 细分后的网格数据
 */
export interface SubdividedMesh {
  positions: Cartesian3[];
  triangles: number[];
}

/**
 * 将接近边界的点吸附到边界上
 *
 * 用于避免因浮点误差导致的裂缝问题
 *
 * @param value - 待吸附的坐标值
 * @returns 吸附后的坐标值
 */
function snapBoundaryPoint(value: number): number {
  if (Math.abs(value) < BOUNDARY_SNAP_THRESHOLD) {
    return 0;
  }
  if (Math.abs(value - DEFAULT_EXTENT) < BOUNDARY_SNAP_THRESHOLD) {
    return DEFAULT_EXTENT;
  }
  return value;
}

/**
 * 在网格上细分边
 *
 * 计算边与网格线的所有交点，生成细分后的点序列
 *
 * @param start - 边的起点
 * @param end - 边的终点
 * @param gridCellSize - 网格单元大小
 * @returns 细分后的点序列
 */
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

/**
 * 细分三角形边并生成网格
 *
 * 将三角形的每条边在网格上进行细分，确保相邻三角形共享边时顶点一致，
 * 避免因浮点误差导致的裂缝问题
 *
 * 算法原理：
 * 1. 边界吸附：将接近边界的点吸附到边界，避免浮点误差
 * 2. 边细分：计算边与网格线的交点，生成细分点序列
 * 3. 边缓存：缓存已细分的边，确保相邻三角形共享边时生成相同的点
 * 4. 递归细分：对复杂三角形递归细分，直到满足精度要求
 *
 * @param tilePoints - 瓦片坐标系中的顶点数组
 * @param triangles - 三角形索引数组
 * @param granularity - 网格细粒度（网格数量）
 * @param projectPoint - 点投影函数，将瓦片坐标转换为世界坐标
 * @returns 细分后的网格数据
 */
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
  const snappedTilePoints = snapAllTilePoints(tilePoints);
  const edgeCache = new Map<string, TilePoint[]>();
  const pointIndexMap = new Map<number, number>();
  const allPositions: Cartesian3[] = [];
  const allTriangles: number[] = [];

  for (let i = 0; i < triangles.length; i += 3) {
    const p0 = snappedTilePoints[triangles[i]];
    const p1 = snappedTilePoints[triangles[i + 1]];
    const p2 = snappedTilePoints[triangles[i + 2]];

    subdivideTriangle(
      p0,
      p1,
      p2,
      gridCellSize,
      edgeCache,
      pointIndexMap,
      allPositions,
      allTriangles,
      projectPoint,
      0,
    );
  }

  return {
    positions: allPositions,
    triangles: allTriangles,
  };
}

/**
 * 吸附所有瓦片点到边界
 *
 * @param tilePoints - 原始瓦片点数组
 * @returns 吸附后的瓦片点数组
 */
function snapAllTilePoints(tilePoints: TilePoint[]): TilePoint[] {
  return tilePoints.map(p => ({
    x: snapBoundaryPoint(p.x),
    y: snapBoundaryPoint(p.y),
  }));
}

/**
 * 创建点的唯一键
 *
 * 使用整数运算生成唯一键，避免浮点数比较问题
 *
 * @param x - x 坐标
 * @param y - y 坐标
 * @returns 点的唯一键
 */
function createPointKey(x: number, y: number): number {
  const ix = Math.round(x * KEY_PRECISION);
  const iy = Math.round(y * KEY_PRECISION);
  return ix * KEY_MULTIPLIER + iy;
}

/**
 * 创建边的唯一键
 *
 * 边键由两个点键组成，确保边的唯一性
 *
 * @param p0 - 边的起点
 * @param p1 - 边的终点
 * @returns 边的唯一键
 */
function createEdgeKey(p0: TilePoint, p1: TilePoint): string {
  const k0 = createPointKey(p0.x, p0.y);
  const k1 = createPointKey(p1.x, p1.y);
  return `${k0}->${k1}`;
}

/**
 * 获取或创建细分的边
 *
 * 从缓存中获取已细分的边，如果不存在则创建并缓存
 * 同时缓存反向边，确保相邻三角形共享边时使用相同的细分结果
 *
 * @param p0 - 边的起点
 * @param p1 - 边的终点
 * @param gridCellSize - 网格单元大小
 * @param edgeCache - 边缓存
 * @returns 细分后的点序列
 */
function getOrSubdivideEdge(
  p0: TilePoint,
  p1: TilePoint,
  gridCellSize: number,
  edgeCache: Map<string, TilePoint[]>,
): TilePoint[] {
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

/**
 * 获取或添加点到位置数组
 *
 * 如果点已存在则返回其索引，否则添加新点并返回新索引
 *
 * @param point - 瓦片点
 * @param pointIndexMap - 点索引映射
 * @param allPositions - 所有位置数组
 * @param projectPoint - 点投影函数
 * @returns 点的索引
 */
function getOrAddPoint(
  point: TilePoint,
  pointIndexMap: Map<number, number>,
  allPositions: Cartesian3[],
  projectPoint: (point: TilePoint) => Cartesian3,
): number {
  const key = createPointKey(point.x, point.y);
  let index = pointIndexMap.get(key);

  if (index === undefined) {
    index = allPositions.length;
    allPositions.push(projectPoint(point));
    pointIndexMap.set(key, index);
  }

  return index;
}

/**
 * 递归细分三角形
 *
 * 使用最长边分割策略递归细分三角形，直到满足精度要求或达到最大深度
 *
 * 算法步骤：
 * 1. 检查是否达到最大深度，如果是则直接输出三角形
 * 2. 细分三角形的三条边
 * 3. 如果没有细分点，直接输出三角形
 * 4. 找到最长的边，在其中点处分割三角形
 * 5. 递归处理两个子三角形
 *
 * @param p0 - 三角形第一个顶点
 * @param p1 - 三角形第二个顶点
 * @param p2 - 三角形第三个顶点
 * @param gridCellSize - 网格单元大小
 * @param edgeCache - 边缓存
 * @param pointIndexMap - 点索引映射
 * @param allPositions - 所有位置数组
 * @param allTriangles - 所有三角形索引数组
 * @param projectPoint - 点投影函数
 * @param depth - 当前递归深度
 */
function subdivideTriangle(
  p0: TilePoint,
  p1: TilePoint,
  p2: TilePoint,
  gridCellSize: number,
  edgeCache: Map<string, TilePoint[]>,
  pointIndexMap: Map<number, number>,
  allPositions: Cartesian3[],
  allTriangles: number[],
  projectPoint: (point: TilePoint) => Cartesian3,
  depth: number,
): void {
  if (depth >= MAX_RECURSION_DEPTH) {
    const i0 = getOrAddPoint(p0, pointIndexMap, allPositions, projectPoint);
    const i1 = getOrAddPoint(p1, pointIndexMap, allPositions, projectPoint);
    const i2 = getOrAddPoint(p2, pointIndexMap, allPositions, projectPoint);
    allTriangles.push(i0, i1, i2);
    return;
  }

  const edge01 = getOrSubdivideEdge(p0, p1, gridCellSize, edgeCache);
  const edge12 = getOrSubdivideEdge(p1, p2, gridCellSize, edgeCache);
  const edge20 = getOrSubdivideEdge(p2, p0, gridCellSize, edgeCache);

  const hasSubdivision = edge01.length > 2 || edge12.length > 2 || edge20.length > 2;

  if (!hasSubdivision) {
    const i0 = getOrAddPoint(p0, pointIndexMap, allPositions, projectPoint);
    const i1 = getOrAddPoint(p1, pointIndexMap, allPositions, projectPoint);
    const i2 = getOrAddPoint(p2, pointIndexMap, allPositions, projectPoint);
    allTriangles.push(i0, i1, i2);
    return;
  }

  const d01 = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
  const d12 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  const d20 = Math.sqrt((p0.x - p2.x) ** 2 + (p0.y - p2.y) ** 2);

  if (d01 >= d12 && d01 >= d20) {
    splitTriangleByEdge(p0, p1, p2, edge01, gridCellSize, edgeCache, pointIndexMap, allPositions, allTriangles, projectPoint, depth);
  }
  else if (d12 >= d01 && d12 >= d20) {
    splitTriangleByEdge(p1, p2, p0, edge12, gridCellSize, edgeCache, pointIndexMap, allPositions, allTriangles, projectPoint, depth);
  }
  else {
    splitTriangleByEdge(p2, p0, p1, edge20, gridCellSize, edgeCache, pointIndexMap, allPositions, allTriangles, projectPoint, depth);
  }
}

/**
 * 沿最长边分割三角形
 *
 * 在最长边的中点处分割三角形，生成两个子三角形
 *
 * @param edgeStart - 最长边的起点
 * @param edgeEnd - 最长边的终点
 * @param oppositeVertex - 对面顶点
 * @param edgePoints - 边的细分点序列
 * @param gridCellSize - 网格单元大小
 * @param edgeCache - 边缓存
 * @param pointIndexMap - 点索引映射
 * @param allPositions - 所有位置数组
 * @param allTriangles - 所有三角形索引数组
 * @param projectPoint - 点投影函数
 * @param depth - 当前递归深度
 */
function splitTriangleByEdge(
  edgeStart: TilePoint,
  edgeEnd: TilePoint,
  oppositeVertex: TilePoint,
  edgePoints: TilePoint[],
  gridCellSize: number,
  edgeCache: Map<string, TilePoint[]>,
  pointIndexMap: Map<number, number>,
  allPositions: Cartesian3[],
  allTriangles: number[],
  projectPoint: (point: TilePoint) => Cartesian3,
  depth: number,
): void {
  const midIndex = Math.floor(edgePoints.length / 2);
  const midPoint = edgePoints[midIndex];

  subdivideTriangle(
    edgeStart,
    midPoint,
    oppositeVertex,
    gridCellSize,
    edgeCache,
    pointIndexMap,
    allPositions,
    allTriangles,
    projectPoint,
    depth + 1,
  );

  subdivideTriangle(
    midPoint,
    edgeEnd,
    oppositeVertex,
    gridCellSize,
    edgeCache,
    pointIndexMap,
    allPositions,
    allTriangles,
    projectPoint,
    depth + 1,
  );
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
