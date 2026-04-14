import type { FillBucketData } from '../../bucket/bucket-types';
import { isValidTypedArray } from '../../utils/validation';

export interface PolygonSlice {
  featureId: number | undefined;
  holes: Uint32Array;
  positions: Float64Array;
  triangles: Uint32Array;
}

export function validateFillBucketData(data: FillBucketData): boolean {
  if (!isValidTypedArray(data.positions, Float64Array)) {
    return false;
  }
  if (!isValidTypedArray(data.triangles, Uint32Array)) {
    return false;
  }
  if (!isValidTypedArray(data.holes, Uint32Array)) {
    return false;
  }
  if (!isValidTypedArray(data.featureIds, Float32Array)) {
    return false;
  }

  if (
    data.polygonVertexCounts
    || data.polygonTriangleCounts
    || data.polygonHoleCounts
  ) {
    if (
      !data.polygonVertexCounts
      || !data.polygonTriangleCounts
      || !data.polygonHoleCounts
    ) {
      return false;
    }

    if (
      data.polygonVertexCounts.length !== data.polygonTriangleCounts.length
      || data.polygonVertexCounts.length !== data.polygonHoleCounts.length
    ) {
      return false;
    }
  }

  return true;
}

export function* iterateFillPolygons(
  data: FillBucketData,
): Generator<PolygonSlice> {
  if (
    data.polygonVertexCounts
    && data.polygonTriangleCounts
    && data.polygonHoleCounts
  ) {
    let vertexOffset = 0;
    let triangleOffset = 0;
    let holeOffset = 0;

    for (let index = 0; index < data.polygonVertexCounts.length; index += 1) {
      const vertexCount = data.polygonVertexCounts[index]!;
      const triangleCount = data.polygonTriangleCounts[index]!;
      const holeCount = data.polygonHoleCounts[index]!;
      const featureId = data.featureIds[vertexOffset];

      yield {
        featureId,
        holes: data.holes.subarray(holeOffset, holeOffset + holeCount),
        positions: data.positions.subarray(
          vertexOffset * 3,
          (vertexOffset + vertexCount) * 3,
        ),
        triangles: rebaseTriangles(
          data.triangles.subarray(
            triangleOffset * 3,
            (triangleOffset + triangleCount) * 3,
          ),
          vertexOffset,
        ),
      };

      vertexOffset += vertexCount;
      triangleOffset += triangleCount;
      holeOffset += holeCount;
    }

    return;
  }

  let vertexOffset = 0;
  let triangleOffset = 0;
  let holeOffset = 0;

  while (vertexOffset < data.featureIds.length) {
    const featureId = data.featureIds[vertexOffset];
    let nextVertexOffset = vertexOffset + 1;
    while (
      nextVertexOffset < data.featureIds.length
      && data.featureIds[nextVertexOffset] === featureId
    ) {
      nextVertexOffset += 1;
    }

    let nextTriangleOffset = triangleOffset;
    while (nextTriangleOffset * 3 < data.triangles.length) {
      const triangleStart = nextTriangleOffset * 3;
      const triangleIndex = data.triangles[triangleStart];
      if (triangleIndex === undefined || triangleIndex >= nextVertexOffset) {
        break;
      }
      nextTriangleOffset += 1;
    }

    const vertexCount = nextVertexOffset - vertexOffset;
    const triangleCount = nextTriangleOffset - triangleOffset;
    const holeCount = Math.max(
      0,
      Math.round((triangleCount - vertexCount + 2) / 2),
    );

    yield {
      featureId,
      holes: data.holes.subarray(holeOffset, holeOffset + holeCount),
      positions: data.positions.subarray(
        vertexOffset * 3,
        nextVertexOffset * 3,
      ),
      triangles: rebaseTriangles(
        data.triangles.subarray(
          triangleOffset * 3,
          nextTriangleOffset * 3,
        ),
        vertexOffset,
      ),
    };

    vertexOffset = nextVertexOffset;
    triangleOffset = nextTriangleOffset;
    holeOffset += holeCount;
  }
}

function rebaseTriangles(triangles: Uint32Array, baseIndex: number): Uint32Array {
  const rebasedTriangles = new Uint32Array(triangles.length);
  for (let index = 0; index < triangles.length; index += 1) {
    rebasedTriangles[index] = triangles[index]! - baseIndex;
  }
  return rebasedTriangles;
}
