import type { MvtFeatureIndex, MvtParsedTileData, MvtTileCoordinate, MvtTileMeshData, MvtTileState } from '../mvt-types';
import { createMvtTileKey } from './mvt-tile-key';

export class MvtTile {
  buildVersion = 0;
  cpuByteLength = 0;
  featureIndex?: MvtFeatureIndex;
  gpuByteLength = 0;
  lastRenderedFrame = -1;
  lastTouchedFrame = -1;
  meshByteLength = 0;
  meshData?: MvtTileMeshData;
  parsedByteLength = 0;
  parsedTileData?: MvtParsedTileData;
  priority = 0;
  readonly coordinate: MvtTileCoordinate;
  readonly key: string;
  sourceCoordinate: MvtTileCoordinate;
  sourceUrl?: string;
  state: MvtTileState = 'idle';
  styleVersion = 0;

  constructor(coordinate: MvtTileCoordinate) {
    this.coordinate = coordinate;
    this.key = createMvtTileKey(coordinate);
    this.sourceCoordinate = { ...coordinate };
  }

  get totalByteLength(): number {
    return this.cpuByteLength + this.gpuByteLength;
  }

  isProtected(currentFrame: number, protectedFrames: number): boolean {
    if (protectedFrames <= 0) {
      return false;
    }

    return this.lastTouchedFrame >= 0 && currentFrame - this.lastTouchedFrame <= protectedFrames;
  }

  markRendered(frameNumber: number): void {
    this.lastRenderedFrame = frameNumber;
  }

  setParsedTileData(parsedTileData?: MvtParsedTileData, sourceUrl?: string): void {
    this.parsedTileData = parsedTileData;
    this.parsedByteLength = parsedTileData?.byteLength ?? 0;
    if (sourceUrl !== undefined) {
      this.sourceUrl = sourceUrl;
    }
  }

  clearParsedTileData(): void {
    this.parsedTileData = undefined;
    this.parsedByteLength = 0;
  }

  setMeshData(meshData?: MvtTileMeshData): void {
    this.meshData = meshData;
    this.meshByteLength = meshData?.byteLength ?? 0;
  }

  setFeatureIndex(featureIndex?: MvtFeatureIndex): void {
    this.featureIndex = featureIndex;
  }

  setSourceCoordinate(sourceCoordinate: MvtTileCoordinate): void {
    this.sourceCoordinate = sourceCoordinate;
  }

  setByteLength(byteLength: { cpu?: number; gpu?: number }): void {
    if (typeof byteLength.cpu === 'number') {
      this.cpuByteLength = byteLength.cpu;
    }
    if (typeof byteLength.gpu === 'number') {
      this.gpuByteLength = byteLength.gpu;
    }
  }

  setState(state: MvtTileState): void {
    this.state = state;
  }

  touch(frameNumber: number, priority = this.priority): void {
    this.lastTouchedFrame = frameNumber;
    this.priority = priority;
  }

  clearPayload(): void {
    this.clearParsedTileData();
    this.setFeatureIndex(undefined);
    this.setMeshData(undefined);
    this.sourceUrl = undefined;
  }
}
