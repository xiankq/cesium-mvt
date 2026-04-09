import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { TilingScheme } from 'cesium';
import type { Bucket, LineBucketData, LineBucketStats } from './bucket-types';
import { subdivideRing } from '../geometry/line-subdivision';
import { createTileProjectionContext, projectTilePoint } from '../geometry/tile-projection';
import { calculateBucketByteLength, calculateFeatureIndexByteLength } from './bucket-types';

export interface BucketBuilderOptions {
  extent: number;
  familyId: string;
  layerIds: string[];
  sourceLayer?: string;
  tilingScheme: TilingScheme;
  level: number;
  x: number;
  y: number;
}

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
    this.projectionContext = createTileProjectionContext(
      options.level,
      options.x,
      options.y,
      options.tilingScheme,
    );
  }

  addFeature(feature: VectorTileFeature, localId: number): void {
    if (feature.type !== 2) {
      return;
    }

    this.featureIndexEntries.push({
      id: feature.id,
      properties: { ...feature.properties },
      type: 'line',
    });

    const geometry = feature.loadGeometry();

    for (const line of geometry) {
      const projectedLine: Array<{ x: number; y: number; z: number }> = [];

      for (const point of line) {
        const projected = projectTilePoint(point, this.extent, this.projectionContext);
        projectedLine.push({
          x: projected.x,
          y: projected.y,
          z: projected.z,
        });
      }

      const subdivided = subdivideRing(
        projectedLine as any,
        10,
      );

      for (const vertex of subdivided) {
        this.positions.push(vertex.x, vertex.y, vertex.z);
        this.featureIds.push(localId);
      }

      this.vertexCounts.push(subdivided.length);
      this._stats.totalVertexCount += subdivided.length;
    }

    this._stats.featureCount += 1;
    this._stats.polylineCount += geometry.length;
  }

  build(): Bucket {
    const byteLength = calculateBucketByteLength(this._stats);
    const featureIndexByteLength = calculateFeatureIndexByteLength(this.featureIndexEntries.length);

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
