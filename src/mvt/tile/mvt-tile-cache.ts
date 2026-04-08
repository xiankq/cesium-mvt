import type { MvtTile } from './mvt-tile';

export interface MvtTileCacheOptions {
  byteLengthSelector: (tile: MvtTile) => number;
  maxByteLength: number;
  protectedFrames?: number;
}

export class MvtTileCache {
  private readonly byteLengthSelector: (tile: MvtTile) => number;
  private currentByteLength = 0;
  private readonly maxByteLength: number;
  private readonly protectedFrames: number;
  private readonly tiles = new Map<string, MvtTile>();

  constructor(options: MvtTileCacheOptions) {
    this.byteLengthSelector = options.byteLengthSelector;
    this.maxByteLength = Math.max(0, options.maxByteLength);
    this.protectedFrames = Math.max(0, options.protectedFrames ?? 0);
  }

  get size(): number {
    return this.tiles.size;
  }

  get totalByteLength(): number {
    return this.currentByteLength;
  }

  clear(): void {
    this.tiles.clear();
    this.currentByteLength = 0;
  }

  delete(tileKey: string): void {
    const tile = this.tiles.get(tileKey);
    if (!tile) {
      return;
    }

    this.currentByteLength -= this.byteLengthSelector(tile);
    this.tiles.delete(tileKey);
  }

  track(tile: MvtTile): void {
    this.delete(tile.key);
    this.tiles.set(tile.key, tile);
    this.currentByteLength += this.byteLengthSelector(tile);
  }

  evict(currentFrame: number): MvtTile[] {
    if (this.currentByteLength <= this.maxByteLength) {
      return [];
    }

    const evictedTiles: MvtTile[] = [];
    for (const [tileKey, tile] of this.tiles) {
      if (this.currentByteLength <= this.maxByteLength) {
        break;
      }
      if (tile.isProtected(currentFrame, this.protectedFrames)) {
        continue;
      }

      this.currentByteLength -= this.byteLengthSelector(tile);
      this.tiles.delete(tileKey);
      evictedTiles.push(tile);
    }

    return evictedTiles;
  }
}
