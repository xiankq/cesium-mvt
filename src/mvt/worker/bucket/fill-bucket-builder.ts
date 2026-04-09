import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { TilingScheme } from 'cesium';
import type { Bucket, FillBucketData, FillBucketStats } from './bucket-types';
import earcut from 'earcut';
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

export class FillBucketBuilder {
  readonly type = 'fill' as const;

  private readonly extent: number;
  private readonly familyId: string;
  private readonly layerIds: string[];
  private readonly sourceLayer?: string;
  private readonly projectionContext: ReturnType<typeof createTileProjectionContext>;

  private featureIndexEntries: Array<{
    id: number | undefined;
    properties: Record<string, string | number | boolean>;
    type: 'polygon';
  }> = [];

  private positions: number[] = [];
  private triangles: number[] = [];
  private holes: number[] = [];
  private featureIds: number[] = [];

  private _stats: FillBucketStats = {
    type: 'fill',
    featureCount: 0,
    byteLength: 0,
    vertexCount: 0,
    triangleCount: 0,
    holeCount: 0,
    polygonCount: 0,
  };

  get stats(): FillBucketStats {
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
    if (feature.type !== 3) {
      return;
    }

    this.featureIndexEntries.push({
      id: feature.id,
      properties: { ...feature.properties },
      type: 'polygon',
    });

    const geometry = feature.loadGeometry();
    const projectedRings: Array<Array<{ x: number; y: number; z: number }>> = [];

    for (const ring of geometry) {
      const projectedRing: Array<{ x: number; y: number; z: number }> = [];

      for (const point of ring) {
        const projected = projectTilePoint(point, this.extent, this.projectionContext);
        projectedRing.push({
          x: projected.x,
          y: projected.y,
          z: projected.z,
        });
      }

      const subdivided = subdivideRing(
        projectedRing.map(p => ({ x: p.x, y: p.y, z: p.z } as any)),
        10,
      );

      projectedRings.push(subdivided.map(p => ({ x: p.x, y: p.y, z: p.z })));
    }

    const flatPositions: number[] = [];
    const flatHoles: number[] = [];
    const flatPositions2D: number[] = [];
    let vertexOffset = 0;

    for (let i = 0; i < projectedRings.length; i++) {
      const ring = projectedRings[i];

      if (i > 0) {
        flatHoles.push(vertexOffset);
      }

      for (const vertex of ring) {
        flatPositions.push(vertex.x, vertex.y, vertex.z);
        flatPositions2D.push(vertex.x, vertex.y);
        this.featureIds.push(localId);
        vertexOffset++;
      }
    }

    const indices = earcut(flatPositions2D, flatHoles.length > 0 ? flatHoles : undefined, 2);

    for (const index of indices) {
      this.triangles.push(this.positions.length / 3 + index);
    }

    this.positions.push(...flatPositions);
    this.holes.push(...flatHoles);

    this._stats.featureCount += 1;
    this._stats.polygonCount += 1;
    this._stats.vertexCount += vertexOffset;
    this._stats.triangleCount += indices.length / 3;
    this._stats.holeCount += flatHoles.length;
  }

  build(): Bucket {
    const byteLength = calculateBucketByteLength(this._stats);
    const featureIndexByteLength = calculateFeatureIndexByteLength(this.featureIndexEntries.length);

    this._stats.byteLength = byteLength;

    const data: FillBucketData = {
      positions: new Float64Array(this.positions),
      triangles: new Uint32Array(this.triangles),
      holes: new Uint32Array(this.holes),
      featureIds: new Float32Array(this.featureIds),
    };

    return {
      type: 'fill',
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
