import type Point from '@mapbox/point-geometry';
import type { MvtBucketFeature, MvtCircleMeshBucket, MvtFillMeshBucket, MvtLineMeshBucket, MvtMeshBucket, MvtMeshIndexArray, MvtParsedTileData, MvtPointBucketFeature, MvtTileBucket, MvtTileMeshData } from '../mvt-types';
import { BoundingRectangle, Cartesian2, IndexDatatype } from '@cesium/engine';
import earcut from 'earcut';
import { normalizePolylinePoints, normalizeRingPoints } from './mvt-geometry-normalize';

type CesiumIndexDatatype = typeof IndexDatatype & {
  createTypedArray: (numberOfVertices: number, indicesLengthOrArray: number[] | number) => MvtMeshIndexArray;
};

const indexDatatype = IndexDatatype as CesiumIndexDatatype;
const scratchDirection = new Cartesian2();
const scratchNormal = new Cartesian2();

export function buildMvtTileMesh(parsedTileData: MvtParsedTileData): MvtTileMeshData {
  const buckets: MvtMeshBucket[] = [];
  let unsupportedBucketCount = 0;

  for (const bucket of parsedTileData.buckets) {
    const meshBucket = buildBucketMesh(bucket);
    if (!meshBucket) {
      unsupportedBucketCount += 1;
      continue;
    }
    if (!meshBucket.vertexCount || !meshBucket.indexCount) {
      continue;
    }

    buckets.push(meshBucket);
  }

  return {
    bucketCount: buckets.length,
    buckets,
    byteLength: buckets.reduce((total, bucket) => total + bucket.byteLength, 0),
    unsupportedBucketCount,
  };
}

function appendCircleFeature(
  feature: MvtPointBucketFeature,
  centers: number[],
  corners: number[],
  indices: number[],
  boundsPoints: Cartesian2[],
): void {
  const pointCorners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;

  for (const part of feature.geometry) {
    for (const point of part) {
      const baseVertex = centers.length / 2;
      for (const [cornerX, cornerY] of pointCorners) {
        centers.push(point.x, point.y);
        corners.push(cornerX, cornerY);
      }
      indices.push(
        baseVertex,
        baseVertex + 1,
        baseVertex + 2,
        baseVertex + 2,
        baseVertex + 1,
        baseVertex + 3,
      );
      boundsPoints.push(new Cartesian2(point.x, point.y));
    }
  }
}

function appendLineFeature(
  feature: Extract<MvtBucketFeature, { geometryType: 'LineString' }>,
  positions: number[],
  extrudes: number[],
  indices: number[],
  boundsPoints: Cartesian2[],
): void {
  for (const part of feature.geometry) {
    const normalizedPart = normalizePolylinePoints(part);
    for (let index = 1; index < normalizedPart.length; index += 1) {
      const start = normalizedPart[index - 1];
      const end = normalizedPart[index];
      const normal = computeSegmentNormal(start, end);
      if (!normal) {
        continue;
      }

      const baseVertex = positions.length / 2;
      positions.push(
        start.x,
        start.y,
        start.x,
        start.y,
        end.x,
        end.y,
        end.x,
        end.y,
      );
      extrudes.push(
        -normal.x,
        -normal.y,
        normal.x,
        normal.y,
        -normal.x,
        -normal.y,
        normal.x,
        normal.y,
      );
      indices.push(
        baseVertex,
        baseVertex + 1,
        baseVertex + 2,
        baseVertex + 2,
        baseVertex + 1,
        baseVertex + 3,
      );
      boundsPoints.push(new Cartesian2(start.x, start.y), new Cartesian2(end.x, end.y));
    }
  }
}

function appendPolygonFeature(
  feature: Extract<MvtBucketFeature, { geometryType: 'Polygon' }>,
  positions: number[],
  indices: number[],
  boundsPoints: Cartesian2[],
): void {
  for (const polygon of feature.geometry) {
    const vertexBase = positions.length / 2;
    const flatCoordinates: number[] = [];
    const holes: number[] = [];
    let polygonVertexCount = 0;

    polygon.forEach((ring, ringIndex) => {
      const normalizedRing = normalizeRingPoints(ring);
      if (normalizedRing.length < 3) {
        return;
      }
      if (ringIndex > 0) {
        holes.push(polygonVertexCount);
      }

      polygonVertexCount += normalizedRing.length;
      for (const point of normalizedRing) {
        flatCoordinates.push(point.x, point.y);
        positions.push(point.x, point.y);
        boundsPoints.push(new Cartesian2(point.x, point.y));
      }
    });

    if (polygonVertexCount < 3) {
      continue;
    }

    const polygonIndices = earcut(flatCoordinates, holes, 2);
    for (const index of polygonIndices) {
      indices.push(vertexBase + index);
    }
  }
}

function buildBucketMesh(bucket: MvtTileBucket): MvtMeshBucket | undefined {
  switch (bucket.type) {
    case 'fill':
      return buildFillMeshBucket(bucket);
    case 'line':
      return buildLineMeshBucket(bucket);
    case 'circle':
      return buildCircleMeshBucket(bucket);
    case 'symbol':
      return undefined;
  }
}

function buildCircleMeshBucket(bucket: MvtTileBucket): MvtCircleMeshBucket {
  const centers: number[] = [];
  const corners: number[] = [];
  const indices: number[] = [];
  const boundsPoints: Cartesian2[] = [];

  for (const feature of bucket.features) {
    if (feature.geometryType !== 'Point') {
      continue;
    }

    appendCircleFeature(feature, centers, corners, indices, boundsPoints);
  }

  const centersArray = new Float32Array(centers);
  const cornersArray = new Int8Array(corners);
  const indexArray = createIndexArray(centersArray.length / 2, indices);

  return {
    bounds: createBounds(boundsPoints),
    byteLength: centersArray.byteLength + cornersArray.byteLength + indexArray.byteLength,
    centers: centersArray,
    corners: cornersArray,
    familyKey: bucket.familyKey,
    indexCount: indexArray.length,
    indices: indexArray,
    layerIds: bucket.layerIds,
    sourceLayer: bucket.sourceLayer,
    type: 'circle',
    vertexCount: centersArray.length / 2,
  };
}

function buildFillMeshBucket(bucket: MvtTileBucket): MvtFillMeshBucket {
  const positions: number[] = [];
  const indices: number[] = [];
  const boundsPoints: Cartesian2[] = [];

  for (const feature of bucket.features) {
    if (feature.geometryType !== 'Polygon') {
      continue;
    }

    appendPolygonFeature(feature, positions, indices, boundsPoints);
  }

  const positionsArray = new Float32Array(positions);
  const indexArray = createIndexArray(positionsArray.length / 2, indices);

  return {
    bounds: createBounds(boundsPoints),
    byteLength: positionsArray.byteLength + indexArray.byteLength,
    familyKey: bucket.familyKey,
    indexCount: indexArray.length,
    indices: indexArray,
    layerIds: bucket.layerIds,
    positions: positionsArray,
    sourceLayer: bucket.sourceLayer,
    type: 'fill',
    vertexCount: positionsArray.length / 2,
  };
}

function buildLineMeshBucket(bucket: MvtTileBucket): MvtLineMeshBucket {
  const positions: number[] = [];
  const extrudes: number[] = [];
  const indices: number[] = [];
  const boundsPoints: Cartesian2[] = [];

  for (const feature of bucket.features) {
    if (feature.geometryType !== 'LineString') {
      continue;
    }

    appendLineFeature(feature, positions, extrudes, indices, boundsPoints);
  }

  const positionsArray = new Float32Array(positions);
  const extrudesArray = new Float32Array(extrudes);
  const indexArray = createIndexArray(positionsArray.length / 2, indices);

  return {
    bounds: createBounds(boundsPoints),
    byteLength: positionsArray.byteLength + extrudesArray.byteLength + indexArray.byteLength,
    extrudes: extrudesArray,
    familyKey: bucket.familyKey,
    indexCount: indexArray.length,
    indices: indexArray,
    layerIds: bucket.layerIds,
    positions: positionsArray,
    sourceLayer: bucket.sourceLayer,
    type: 'line',
    vertexCount: positionsArray.length / 2,
  };
}

function computeSegmentNormal(start: Point, end: Point): Cartesian2 | undefined {
  const startPosition = new Cartesian2(start.x, start.y);
  const endPosition = new Cartesian2(end.x, end.y);
  const direction = Cartesian2.subtract(endPosition, startPosition, scratchDirection);
  if (Cartesian2.magnitudeSquared(direction) === 0) {
    return undefined;
  }

  Cartesian2.normalize(direction, direction);
  scratchNormal.x = -direction.y;
  scratchNormal.y = direction.x;
  Cartesian2.normalize(scratchNormal, scratchNormal);
  return Cartesian2.clone(scratchNormal);
}

function createBounds(points: Cartesian2[]): BoundingRectangle {
  if (!points.length) {
    return new BoundingRectangle();
  }

  return BoundingRectangle.fromPoints(points);
}

function createIndexArray(vertexCount: number, indices: number[]): MvtMeshIndexArray {
  return indexDatatype.createTypedArray(vertexCount, indices);
}
