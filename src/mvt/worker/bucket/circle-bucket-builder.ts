import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { TileProjectionData } from '../geometry/tile-projection';
import type { Bucket, CircleBucketData, CircleBucketStats } from './bucket-types';
import { createTileProjectionContext, projectTilePoint } from '../geometry/tile-projection';
import { calculateBucketByteLength, calculateFeatureIndexByteLength } from './bucket-types';

export interface BucketBuilderOptions {
  extent: number;
  familyId: string;
  layerIds: string[];
  sourceLayer?: string;
  tileProjection: TileProjectionData;
  tileKey: string;
}

export class CircleBucketBuilder {
  readonly type = 'circle' as const;

  private readonly extent: number;
  private readonly familyId: string;
  private readonly layerIds: string[];
  private readonly sourceLayer?: string;
  private readonly projectionContext: ReturnType<typeof createTileProjectionContext>;

  private featureIndexEntries: Array<{
    id: number | undefined;
    properties: Record<string, string | number | boolean>;
    type: 'point';
  }> = [];

  private positions: number[] = [];
  private featureIds: number[] = [];

  private _stats: CircleBucketStats = {
    type: 'circle',
    featureCount: 0,
    byteLength: 0,
    pointCount: 0,
  };

  get stats(): CircleBucketStats {
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
    if (feature.type !== 1) {
      return;
    }

    this.featureIndexEntries.push({
      id: feature.id,
      properties: { ...feature.properties },
      type: 'point',
    });

    const geometry = feature.loadGeometry();

    for (const points of geometry) {
      for (const point of points) {
        const projected = projectTilePoint(point, this.extent, this.projectionContext);
        this.positions.push(projected.x, projected.y, projected.z);
        this.featureIds.push(localId);
        this._stats.pointCount += 1;
      }
    }

    this._stats.featureCount += 1;
  }

  build(): Bucket {
    const byteLength = calculateBucketByteLength(this._stats);
    const featureIndexByteLength = calculateFeatureIndexByteLength(this.featureIndexEntries.length);

    this._stats.byteLength = byteLength;

    const data: CircleBucketData = {
      positions: new Float64Array(this.positions),
      featureIds: new Float32Array(this.featureIds),
    };

    return {
      type: 'circle',
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
