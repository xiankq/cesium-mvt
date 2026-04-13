import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { Cartesian3 } from 'cesium';
import type { TilePoint } from '../geometry/grid-subdivision';
import type { Bucket, BucketBuilderOptions, FillBucketData, FillBucketStats } from './bucket-types';
import { classifyRings } from '@mapbox/vector-tile';
import earcut from 'earcut';
import { getGranularityForZoomLevel, subdivideTriangleEdges } from '../geometry/grid-subdivision';
import { createTileProjectionContext, projectTilePoint } from '../geometry/tile-projection';
import { calculateBucketByteLength, calculateFeatureIndexByteLength } from './bucket-types';

const DEFAULT_GRANULARITY = 128;

export class FillBucketBuilder {
  readonly type = 'fill' as const;

  private readonly extent: number;
  private readonly familyId: string;
  private readonly layerIds: string[];
  private readonly sourceLayer?: string;
  private readonly projectionContext: ReturnType<typeof createTileProjectionContext>;
  private readonly granularity: number;

  private featureIndexEntries: Array<{
    id: number | undefined;
    properties: Record<string, string | number | boolean>;
    type: 'polygon';
  }> = [];

  private positions: number[] = [];
  private triangles: number[] = [];
  private holes: number[] = [];
  private featureIds: number[] = [];
  private polygonHoleCounts: number[] = [];
  private polygonTriangleCounts: number[] = [];
  private polygonVertexCounts: number[] = [];

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
    this.projectionContext = createTileProjectionContext(options.tileProjection);
    this.granularity = options.zoom !== undefined
      ? getGranularityForZoomLevel(options.zoom)
      : DEFAULT_GRANULARITY;
  }

  addFeature(feature: VectorTileFeature, localId: number): void {
    if (feature.type !== 3) {
      return;
    }

    this.featureIndexEntries[localId] = {
      id: feature.id,
      properties: { ...feature.properties },
      type: 'polygon',
    };

    const geometry = feature.loadGeometry();
    const classifiedRings = classifyRings(geometry);

    for (const polygonRings of classifiedRings) {
      this.addPolygon(polygonRings, localId);
    }
  }

  private addPolygon(
    rings: Array<Array<{ x: number; y: number }>>,
    localId: number,
  ): void {
    const normalizedRings = rings
      .map(ring => this.normalizeRing(ring))
      .filter(ring => ring.length >= 3);

    if (normalizedRings.length === 0) {
      return;
    }

    const tilePoints: TilePoint[] = [];
    const flatHoles: number[] = [];
    const triangulationPositions: number[] = [];
    let vertexOffset = 0;

    for (let ringIndex = 0; ringIndex < normalizedRings.length; ringIndex++) {
      const ring = normalizedRings[ringIndex];

      if (ringIndex > 0) {
        flatHoles.push(vertexOffset);
      }

      for (const point of ring) {
        tilePoints.push({ x: point.x, y: point.y });
        triangulationPositions.push(point.x, point.y);
        vertexOffset++;
      }
    }

    const indices = earcut(triangulationPositions, flatHoles.length > 0 ? flatHoles : undefined, 2);

    if (indices.length === 0) {
      return;
    }

    const projectPoint = (point: TilePoint): Cartesian3 => {
      return projectTilePoint(point, this.extent, this.projectionContext);
    };

    const { positions: subdividedPositions, triangles: subdividedTriangles } = subdivideTriangleEdges(
      tilePoints,
      Array.from(indices),
      this.granularity,
      projectPoint,
    );

    if (subdividedPositions.length === 0 || subdividedTriangles.length === 0) {
      return;
    }

    const baseIndex = this.positions.length / 3;
    for (const vertex of subdividedPositions) {
      this.positions.push(vertex.x, vertex.y, vertex.z);
      this.featureIds.push(localId);
    }

    for (const index of subdividedTriangles) {
      this.triangles.push(baseIndex + index);
    }

    this.holes.push(...flatHoles);
    this.polygonHoleCounts.push(flatHoles.length);
    this.polygonTriangleCounts.push(subdividedTriangles.length / 3);
    this.polygonVertexCounts.push(subdividedPositions.length);

    this._stats.featureCount += 1;
    this._stats.polygonCount += 1;
    this._stats.vertexCount += subdividedPositions.length;
    this._stats.triangleCount += subdividedTriangles.length / 3;
    this._stats.holeCount += flatHoles.length;
  }

  private normalizeRing(ring: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (ring.length < 2) {
      return ring;
    }

    const firstPoint = ring[0];
    const lastPoint = ring[ring.length - 1];
    if (firstPoint.x !== lastPoint.x || firstPoint.y !== lastPoint.y) {
      return ring;
    }

    return ring.slice(0, -1);
  }

  build(): Bucket {
    const byteLength = calculateBucketByteLength(this._stats);
    const featureIndexByteLength = calculateFeatureIndexByteLength(this.featureIndexEntries);

    this._stats.byteLength = byteLength;

    const data: FillBucketData = {
      holes: new Uint32Array(this.holes),
      polygonHoleCounts: new Uint32Array(this.polygonHoleCounts),
      polygonTriangleCounts: new Uint32Array(this.polygonTriangleCounts),
      polygonVertexCounts: new Uint32Array(this.polygonVertexCounts),
      positions: new Float64Array(this.positions),
      triangles: new Uint32Array(this.triangles),
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
