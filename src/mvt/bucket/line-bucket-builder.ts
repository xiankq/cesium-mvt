import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { Bucket, BucketBuilderOptions, LineBucketData, LineBucketStats } from './bucket-types';
import { Cartesian3 } from 'cesium';
import { subdivideLine } from '../geometry/line-subdivision';
import { createTileProjectionContext, projectTilePoint } from '../geometry/tile-projection';
import { calculateBucketByteLength, calculateFeatureIndexByteLength } from './bucket-types';

const DEFAULT_MAX_CHORD_ERROR = 10000;
const MIN_SEGMENT_DISTANCE = 1e-10;
const LINE_HEIGHT_OFFSET = 1;

export class LineBucketBuilder {
  readonly type = 'line' as const;

  private readonly extent: number;
  private readonly familyId: string;
  private readonly layerIds: string[];
  private readonly sourceLayer?: string;
  private readonly projectionContext: ReturnType<typeof createTileProjectionContext>;

  private featureIndexEntries: Array<{
    id: number | undefined;
    properties: Record<string, string | number | boolean>;
    type: 'line';
  }> = [];

  private positions: number[] = [];
  private vertexCounts: number[] = [];
  private featureIds: number[] = [];

  private _stats: LineBucketStats = {
    type: 'line',
    featureCount: 0,
    byteLength: 0,
    polylineCount: 0,
    totalVertexCount: 0,
  };

  get stats(): LineBucketStats {
    return this._stats;
  }

  constructor(options: BucketBuilderOptions) {
    this.extent = options.extent;
    this.familyId = options.familyId;
    this.layerIds = options.layerIds;
    this.sourceLayer = options.sourceLayer;
    this.projectionContext = createTileProjectionContext(options.tileProjection);
  }

  addFeature(feature: VectorTileFeature, localId: number): void {
    if (feature.type !== 2) {
      return;
    }

    const geometry = feature.loadGeometry();

    let hasValidLine = false;
    const tempPositions: number[] = [];
    const tempVertexCounts: number[] = [];
    const tempFeatureIds: number[] = [];
    let tempPolylineCount = 0;
    let tempTotalVertexCount = 0;

    for (const line of geometry) {
      if (line.length < 2) {
        continue;
      }

      const projectedLine = this.projectAndSubdivideLine(line);
      const vertexCount = projectedLine.length / 3;

      if (vertexCount === 0) {
        continue;
      }

      hasValidLine = true;

      for (let i = 0; i < vertexCount; i++) {
        tempPositions.push(projectedLine[i * 3], projectedLine[i * 3 + 1], projectedLine[i * 3 + 2]);
        tempFeatureIds.push(localId);
      }

      tempVertexCounts.push(vertexCount);
      tempTotalVertexCount += vertexCount;
      tempPolylineCount += 1;
    }

    if (!hasValidLine) {
      return;
    }

    this.featureIndexEntries[localId] = {
      id: feature.id,
      properties: { ...feature.properties },
      type: 'line',
    };

    this.positions.push(...tempPositions);
    this.vertexCounts.push(...tempVertexCounts);
    this.featureIds.push(...tempFeatureIds);

    this._stats.featureCount += 1;
    this._stats.polylineCount += tempPolylineCount;
    this._stats.totalVertexCount += tempTotalVertexCount;
  }

  private projectAndSubdivideLine(line: Array<{ x: number; y: number }>): number[] {
    const result: number[] = [];
    const projectedPoints: Cartesian3[] = [];

    for (const point of line) {
      const projected = projectTilePoint(point, this.extent, this.projectionContext, LINE_HEIGHT_OFFSET);
      projectedPoints.push(projected);
    }

    let hasValidSegment = false;
    for (let index = 0; index < projectedPoints.length - 1; index += 1) {
      const start = projectedPoints[index];
      const end = projectedPoints[index + 1];
      if (Cartesian3.distance(start, end) > MIN_SEGMENT_DISTANCE) {
        hasValidSegment = true;
        break;
      }
    }

    if (!hasValidSegment) {
      return [];
    }

    for (let i = 0; i < projectedPoints.length - 1; i++) {
      const start = projectedPoints[i];
      const end = projectedPoints[i + 1];

      const subdivided = subdivideLine(start, end, DEFAULT_MAX_CHORD_ERROR);

      for (let index = 0; index < subdivided.length - 1; index += 1) {
        const point = subdivided[index];
        result.push(point.x, point.y, point.z);
      }
    }

    const lastPoint = projectedPoints[projectedPoints.length - 1];
    result.push(lastPoint.x, lastPoint.y, lastPoint.z);

    return result;
  }

  build(): Bucket {
    const byteLength = calculateBucketByteLength(this._stats);
    const featureIndexByteLength = calculateFeatureIndexByteLength(this.featureIndexEntries);

    this._stats.byteLength = byteLength;

    const data: LineBucketData = {
      positions: new Float64Array(this.positions),
      vertexCounts: new Uint32Array(this.vertexCounts),
      featureIds: new Float32Array(this.featureIds),
    };

    return {
      type: 'line',
      familyId: this.familyId,
      layerIds: this.layerIds,
      sourceLayer: this.sourceLayer,
      stats: this._stats,
      data,
      featureIndex: {
        entries: this.featureIndexEntries,
        byteLength: featureIndexByteLength,
      },
    };
  }
}
