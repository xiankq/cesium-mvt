import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { Bucket, BucketBuilderOptions, SymbolBucketData, SymbolBucketStats } from './bucket-types';
import { createTileProjectionContext, projectTilePoint } from '../geometry/tile-projection';
import { calculateBucketByteLength, calculateFeatureIndexByteLength } from './bucket-types';

const SYMBOL_HEIGHT_OFFSET = 2;
const DEFAULT_SYMBOL_SPACING = 250;
const LINE_ANGLE_SAMPLE_FRACTION = 8;
const LINE_ANGLE_SAMPLE_MAX = 32;
const LINE_POINT_EPSILON = 1e-6;

export class SymbolBucketBuilder {
  readonly type = 'symbol' as const;

  private readonly extent: number;
  private readonly familyId: string;
  private readonly layerIds: string[];
  private readonly sourceLayer?: string;
  private readonly symbolPlacement: 'point' | 'line' | 'line-center';
  private readonly symbolSpacing: number;
  private readonly projectionContext: ReturnType<typeof createTileProjectionContext>;

  private featureIndexEntries: Array<{
    id: number | undefined;
    properties: Record<string, string | number | boolean>;
    type: 'point' | 'line';
  }> = [];

  private positions: number[] = [];
  private featureIds: number[] = [];
  private lineAngles: number[] = [];

  private _stats: SymbolBucketStats = {
    type: 'symbol',
    featureCount: 0,
    byteLength: 0,
    labelCount: 0,
    billboardCount: 0,
  };

  get stats(): SymbolBucketStats {
    return this._stats;
  }

  constructor(options: BucketBuilderOptions) {
    this.extent = options.extent;
    this.familyId = options.familyId;
    this.layerIds = options.layerIds;
    this.sourceLayer = options.sourceLayer;
    this.symbolPlacement = options.symbolPlacement ?? 'point';
    this.symbolSpacing = options.symbolSpacing ?? DEFAULT_SYMBOL_SPACING;
    this.projectionContext = createTileProjectionContext(options.tileProjection);
  }

  addFeature(feature: VectorTileFeature, localId: number): void {
    if (feature.type === 1 && this.symbolPlacement === 'point') {
      this.addPointFeature(feature, localId);
      return;
    }

    if (feature.type === 2 && this.symbolPlacement !== 'point') {
      this.addLineFeature(feature, localId);
    }
  }

  private addPointFeature(feature: VectorTileFeature, localId: number): void {
    const geometry = feature.loadGeometry();
    let acceptedPointCount = 0;

    for (const points of geometry) {
      for (const point of points) {
        // MapLibre 会丢掉 tile buffer 外的符号锚点，避免相邻瓦片把同一标签画两次。
        if (point.x < 0 || point.x >= this.extent || point.y < 0 || point.y >= this.extent) {
          continue;
        }

        const projected = projectTilePoint(point, this.extent, this.projectionContext, SYMBOL_HEIGHT_OFFSET);
        this.positions.push(projected.x, projected.y, projected.z);
        this.featureIds.push(localId);
        acceptedPointCount += 1;
      }
    }

    if (acceptedPointCount === 0) {
      return;
    }

    this.featureIndexEntries[localId] = {
      id: feature.id,
      properties: { ...feature.properties },
      type: 'point',
    };

    this._stats.featureCount += 1;
  }

  private addLineFeature(feature: VectorTileFeature, localId: number): void {
    const geometry = feature.loadGeometry();
    let acceptedAnchorCount = 0;

    for (const line of geometry) {
      const center = this.getLineCenter(line);
      const anchors = this.symbolPlacement === 'line'
        ? this.getLineAnchors(line)
        : center
          ? [this.createLineCenterAnchor(line, center)]
          : [];

      for (const anchor of anchors) {
        if (anchor.x < 0 || anchor.x >= this.extent || anchor.y < 0 || anchor.y >= this.extent) {
          continue;
        }

        const projected = projectTilePoint(anchor, this.extent, this.projectionContext, SYMBOL_HEIGHT_OFFSET);
        this.positions.push(projected.x, projected.y, projected.z);
        this.featureIds.push(localId);
        this.lineAngles.push(anchor.angle);
        acceptedAnchorCount += 1;
      }
    }

    if (acceptedAnchorCount === 0) {
      return;
    }

    this.featureIndexEntries[localId] = {
      id: feature.id,
      properties: { ...feature.properties },
      type: 'line',
    };

    this._stats.featureCount += 1;
  }

  private getLineAnchors(line: Array<{ x: number; y: number }>): Array<{ x: number; y: number; angle: number }> {
    if (line.length < 2) {
      return [];
    }

    const spacing = this.getLineSpacing();
    if (spacing <= 0) {
      const center = this.getLineCenter(line);
      return center ? [this.createLineCenterAnchor(line, center)] : [];
    }

    const anchors: Array<{ x: number; y: number; angle: number }> = [];
    let traversed = 0;
    let targetDistance = spacing / 2;

    for (let index = 1; index < line.length; index += 1) {
      const start = line[index - 1];
      const end = line[index];
      const segmentLength = distance(start, end);
      if (segmentLength === 0) {
        continue;
      }

      while (targetDistance <= traversed + segmentLength) {
        const ratio = (targetDistance - traversed) / segmentLength;
        anchors.push({
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
          angle: this.getLineAnchorAngle(line, index, ratio),
        });
        targetDistance += spacing;
      }

      traversed += segmentLength;
    }

    if (anchors.length === 0) {
      const center = this.getLineCenter(line);
      if (center) {
        anchors.push(this.createLineCenterAnchor(line, center));
      }
    }

    return anchors;
  }

  private createLineCenterAnchor(
    line: Array<{ x: number; y: number }>,
    center: { x: number; y: number },
  ): { x: number; y: number; angle: number } {
    return {
      angle: this.getLineAnchorAngleAtPoint(line, center),
      x: center.x,
      y: center.y,
    };
  }

  private getLineAnchorAngle(
    line: Array<{ x: number; y: number }>,
    segmentIndex: number,
    ratio: number,
  ): number {
    const sampledAngle = this.getLineSampledTurnAngle(line, segmentIndex, ratio);
    if (sampledAngle !== undefined) {
      return sampledAngle;
    }

    if (ratio <= LINE_POINT_EPSILON && segmentIndex > 0) {
      return this.getLineVertexTurnAngle(line, segmentIndex);
    }

    if (ratio >= 1 - LINE_POINT_EPSILON && segmentIndex < line.length - 2) {
      return this.getLineVertexTurnAngle(line, segmentIndex + 1);
    }

    return 0;
  }

  private getLineAnchorAngleAtPoint(
    line: Array<{ x: number; y: number }>,
    point: { x: number; y: number },
  ): number {
    const location = this.getLinePointLocation(line, point);
    if (!location) {
      return 0;
    }

    return this.getLineAnchorAngle(line, location.segmentIndex, location.ratio);
  }

  private getLineVertexTurnAngle(
    line: Array<{ x: number; y: number }>,
    vertexIndex: number,
  ): number {
    if (vertexIndex <= 0 || vertexIndex >= line.length - 1) {
      return 0;
    }

    const previous = line[vertexIndex - 1];
    const center = line[vertexIndex];
    const next = line[vertexIndex + 1];
    return calculateTurnAngle(previous, center, next);
  }

  private getLineCenter(line: Array<{ x: number; y: number }>): { x: number; y: number } | undefined {
    if (line.length < 2) {
      return undefined;
    }

    let totalLength = 0;
    for (let index = 1; index < line.length; index += 1) {
      totalLength += distance(line[index - 1], line[index]);
    }

    if (totalLength === 0) {
      return undefined;
    }

    const targetDistance = totalLength / 2;
    let traversed = 0;

    for (let index = 1; index < line.length; index += 1) {
      const start = line[index - 1];
      const end = line[index];
      const segmentLength = distance(start, end);
      if (segmentLength === 0) {
        continue;
      }

      if (traversed + segmentLength >= targetDistance) {
        const ratio = (targetDistance - traversed) / segmentLength;
        return {
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        };
      }

      traversed += segmentLength;
    }

    return line[line.length - 1];
  }

  private getLineSpacing(): number {
    // MapLibre 的 symbol-spacing 以像素为单位，这里按 tile 解析度折算成当前瓦片坐标系。
    return this.symbolSpacing * (this.extent / 512);
  }

  private getLineSampleDistance(): number {
    return Math.max(
      1,
      Math.min(
        this.getLineSpacing() / LINE_ANGLE_SAMPLE_FRACTION,
        this.extent / 128,
        LINE_ANGLE_SAMPLE_MAX,
      ),
    );
  }

  private getLineSampledTurnAngle(
    line: Array<{ x: number; y: number }>,
    segmentIndex: number,
    ratio: number,
  ): number | undefined {
    const anchorPoint = this.getLinePointOnSegment(line, segmentIndex, ratio);
    if (!anchorPoint) {
      return undefined;
    }

    const sampleDistance = this.getLineSampleDistance();
    const beforePoint = this.getLinePointAtDistance(
      line,
      segmentIndex,
      ratio,
      -sampleDistance,
    );
    const afterPoint = this.getLinePointAtDistance(
      line,
      segmentIndex,
      ratio,
      sampleDistance,
    );
    if (!beforePoint || !afterPoint) {
      return undefined;
    }

    return calculateTurnAngle(beforePoint, anchorPoint, afterPoint);
  }

  private getLinePointLocation(
    line: Array<{ x: number; y: number }>,
    point: { x: number; y: number },
  ): { ratio: number; segmentIndex: number } | undefined {
    for (let index = 1; index < line.length; index += 1) {
      const ratio = this.getLinePointRatioOnSegment(line, index, point);
      if (ratio !== undefined) {
        return {
          ratio,
          segmentIndex: index,
        };
      }
    }

    return undefined;
  }

  private getLinePointRatioOnSegment(
    line: Array<{ x: number; y: number }>,
    segmentIndex: number,
    point: { x: number; y: number },
  ): number | undefined {
    if (segmentIndex <= 0 || segmentIndex >= line.length) {
      return undefined;
    }

    const start = line[segmentIndex - 1];
    const end = line[segmentIndex];
    const segmentVectorX = end.x - start.x;
    const segmentVectorY = end.y - start.y;
    const segmentLengthSquared = (segmentVectorX * segmentVectorX)
      + (segmentVectorY * segmentVectorY);
    if (segmentLengthSquared === 0) {
      return undefined;
    }

    const pointVectorX = point.x - start.x;
    const pointVectorY = point.y - start.y;
    const cross = (segmentVectorX * pointVectorY) - (segmentVectorY * pointVectorX);
    const tolerance = Math.max(1e-6, segmentLengthSquared * LINE_POINT_EPSILON);
    if (Math.abs(cross) > tolerance) {
      return undefined;
    }

    const ratio = ((pointVectorX * segmentVectorX) + (pointVectorY * segmentVectorY)) / segmentLengthSquared;
    if (ratio < -LINE_POINT_EPSILON || ratio > 1 + LINE_POINT_EPSILON) {
      return undefined;
    }

    return ratio;
  }

  private getLinePointOnSegment(
    line: Array<{ x: number; y: number }>,
    segmentIndex: number,
    ratio: number,
  ): { x: number; y: number } | undefined {
    if (segmentIndex <= 0 || segmentIndex >= line.length || !Number.isFinite(ratio)) {
      return undefined;
    }

    const start = line[segmentIndex - 1];
    const end = line[segmentIndex];
    const segmentVectorX = end.x - start.x;
    const segmentVectorY = end.y - start.y;

    return {
      x: start.x + segmentVectorX * ratio,
      y: start.y + segmentVectorY * ratio,
    };
  }

  private getLinePointAtDistance(
    line: Array<{ x: number; y: number }>,
    segmentIndex: number,
    ratio: number,
    offsetDistance: number,
  ): { x: number; y: number } | undefined {
    if (line.length < 2) {
      return undefined;
    }

    const anchorDistance = this.getLineDistanceAtSegment(line, segmentIndex, ratio);
    if (anchorDistance === undefined) {
      return undefined;
    }

    const totalLength = this.getLineTotalLength(line);
    const targetDistance = anchorDistance + offsetDistance;
    if (targetDistance < 0 || targetDistance > totalLength) {
      return undefined;
    }

    let traversed = 0;
    for (let index = 1; index < line.length; index += 1) {
      const start = line[index - 1];
      const end = line[index];
      const segmentLength = distance(start, end);
      if (segmentLength === 0) {
        continue;
      }

      if (traversed + segmentLength >= targetDistance) {
        const segmentRatio = (targetDistance - traversed) / segmentLength;
        return {
          x: start.x + (end.x - start.x) * segmentRatio,
          y: start.y + (end.y - start.y) * segmentRatio,
        };
      }

      traversed += segmentLength;
    }

    return line[line.length - 1];
  }

  private getLineDistanceAtSegment(
    line: Array<{ x: number; y: number }>,
    segmentIndex: number,
    ratio: number,
  ): number | undefined {
    if (segmentIndex <= 0 || segmentIndex >= line.length) {
      return undefined;
    }

    let traversed = 0;
    for (let index = 1; index < segmentIndex; index += 1) {
      traversed += distance(line[index - 1], line[index]);
    }

    const start = line[segmentIndex - 1];
    const end = line[segmentIndex];
    const segmentLength = distance(start, end);
    if (segmentLength === 0 || !Number.isFinite(ratio)) {
      return undefined;
    }

    return traversed + segmentLength * ratio;
  }

  private getLineTotalLength(
    line: Array<{ x: number; y: number }>,
  ): number {
    let totalLength = 0;
    for (let index = 1; index < line.length; index += 1) {
      totalLength += distance(line[index - 1], line[index]);
    }

    return totalLength;
  }

  build(): Bucket {
    const symbolCount = this.positions.length / 3;
    this._stats.labelCount = symbolCount;

    const byteLength = calculateBucketByteLength(this._stats);
    const featureIndexByteLength = calculateFeatureIndexByteLength(this.featureIndexEntries);

    this._stats.byteLength = byteLength;

    const data: SymbolBucketData = {
      positions: new Float64Array(this.positions),
      featureIds: new Float32Array(this.featureIds),
    };

    if (this.lineAngles.length > 0) {
      data.lineAngles = new Float32Array(this.lineAngles);
    }

    const bucket: Bucket = {
      type: 'symbol',
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

    return bucket;
  }
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.hypot(dx, dy);
}

function calculateTurnAngle(
  previous: { x: number; y: number },
  center: { x: number; y: number },
  next: { x: number; y: number },
): number {
  const previousVectorX = previous.x - center.x;
  const previousVectorY = previous.y - center.y;
  const nextVectorX = next.x - center.x;
  const nextVectorY = next.y - center.y;

  const previousLength = Math.hypot(previousVectorX, previousVectorY);
  const nextLength = Math.hypot(nextVectorX, nextVectorY);
  if (previousLength === 0 || nextLength === 0) {
    return 0;
  }

  const dotProduct = ((previousVectorX / previousLength) * (nextVectorX / nextLength))
    + ((previousVectorY / previousLength) * (nextVectorY / nextLength));
  const clampedDot = Math.min(1, Math.max(-1, dotProduct));
  return Math.acos(clampedDot) * (180 / Math.PI);
}
