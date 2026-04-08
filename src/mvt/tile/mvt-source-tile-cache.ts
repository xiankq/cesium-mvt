import type { MvtTileCoordinate } from '../mvt-types';
import type { MvtTileLoader, MvtTileLoadResult } from './mvt-tile-loader';
import { createMvtTileKey } from './mvt-tile-key';

interface MvtSourceTileCacheEntry {
  consumers: Set<string>;
  inflight?: {
    abortController: AbortController;
    promise: Promise<MvtTileLoadResult>;
  };
  lastAccessFrame: number;
  result?: MvtTileLoadResult;
}

export interface MvtSourceTileCacheOptions {
  maxByteLength?: number;
  protectedFrames?: number;
}

export class MvtSourceTileCache {
  private currentFrameNumber = 0;
  private readonly entries = new Map<string, MvtSourceTileCacheEntry>();
  private readonly maxByteLength: number;
  private readonly protectedFrames: number;
  private totalByteLength = 0;

  constructor(options: MvtSourceTileCacheOptions = {}) {
    this.maxByteLength = Math.max(0, options.maxByteLength ?? 24 * 1024 * 1024);
    this.protectedFrames = Math.max(0, options.protectedFrames ?? 2);
  }

  get byteLength(): number {
    return this.totalByteLength;
  }

  beginFrame(frameNumber: number): void {
    this.currentFrameNumber = frameNumber;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.inflight?.abortController.abort();
    }
    this.entries.clear();
    this.totalByteLength = 0;
  }

  acquire(
    coordinate: MvtTileCoordinate,
    consumerTileKey: string,
    tileLoader: MvtTileLoader,
  ): Promise<MvtTileLoadResult> {
    const tileKey = createMvtTileKey(coordinate);
    const entry = this.getOrCreateEntry(tileKey);
    entry.consumers.add(consumerTileKey);
    this.touchEntry(tileKey, entry);

    if (entry.result) {
      return Promise.resolve(entry.result);
    }

    if (entry.inflight) {
      return entry.inflight.promise;
    }

    const abortController = new AbortController();
    const inflight = {
      abortController,
      promise: tileLoader
        .loadTile(coordinate, abortController.signal)
        .then((result) => {
          const currentEntry = this.entries.get(tileKey);
          if (!currentEntry) {
            return result;
          }

          currentEntry.inflight = undefined;
          currentEntry.result = result;
          currentEntry.lastAccessFrame = this.currentFrameNumber;
          this.totalByteLength += result.byteLength;
          this.touchEntry(tileKey, currentEntry);
          return result;
        })
        .catch((error) => {
          const currentEntry = this.entries.get(tileKey);
          if (currentEntry?.inflight === inflight) {
            currentEntry.inflight = undefined;
            if (!currentEntry.result && currentEntry.consumers.size === 0) {
              this.entries.delete(tileKey);
            }
          }
          throw error;
        }),
    };
    entry.inflight = inflight;
    return inflight.promise;
  }

  evict(): void {
    if (this.totalByteLength <= this.maxByteLength) {
      return;
    }

    for (const [tileKey, entry] of this.entries) {
      if (this.totalByteLength <= this.maxByteLength) {
        return;
      }

      if (!entry.result || entry.consumers.size > 0) {
        continue;
      }
      if (this.currentFrameNumber - entry.lastAccessFrame <= this.protectedFrames) {
        continue;
      }

      this.totalByteLength -= entry.result.byteLength;
      entry.result = undefined;
      if (!entry.inflight) {
        this.entries.delete(tileKey);
      }
    }
  }

  get(coordinate: MvtTileCoordinate): MvtTileLoadResult | undefined {
    const tileKey = createMvtTileKey(coordinate);
    const entry = this.entries.get(tileKey);
    if (!entry?.result) {
      return undefined;
    }

    this.touchEntry(tileKey, entry);
    return entry.result;
  }

  release(coordinate: MvtTileCoordinate, consumerTileKey: string): void {
    const tileKey = createMvtTileKey(coordinate);
    const entry = this.entries.get(tileKey);
    if (!entry) {
      return;
    }

    entry.consumers.delete(consumerTileKey);
    if (entry.consumers.size > 0) {
      return;
    }

    if (!entry.result && entry.inflight) {
      entry.inflight.abortController.abort();
      this.entries.delete(tileKey);
      return;
    }

    if (!entry.result && !entry.inflight) {
      this.entries.delete(tileKey);
    }
  }

  private getOrCreateEntry(tileKey: string): MvtSourceTileCacheEntry {
    const entry = this.entries.get(tileKey);
    if (entry) {
      return entry;
    }

    const newEntry: MvtSourceTileCacheEntry = {
      consumers: new Set(),
      lastAccessFrame: this.currentFrameNumber,
    };
    this.entries.set(tileKey, newEntry);
    return newEntry;
  }

  private touchEntry(tileKey: string, entry: MvtSourceTileCacheEntry): void {
    entry.lastAccessFrame = this.currentFrameNumber;
    this.entries.delete(tileKey);
    this.entries.set(tileKey, entry);
  }
}
