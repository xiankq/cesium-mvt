import type { MvtTile } from './mvt-tile';
import TinyQueue from 'tinyqueue';

interface QueueEntry {
  priority: number;
  sequence: number;
  tile: MvtTile;
  version: number;
}

export class MvtTileQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private readonly heap = new TinyQueue<QueueEntry>([], compareQueueEntry);
  private nextSequence = 0;
  private nextVersion = 0;

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.heap.data.length = 0;
    this.heap.length = 0;
  }

  has(tileKey: string): boolean {
    return this.entries.has(tileKey);
  }

  popNext(): MvtTile | undefined {
    while (this.heap.length > 0) {
      const nextEntry = this.heap.pop();
      if (!nextEntry) {
        return undefined;
      }

      const activeEntry = this.entries.get(nextEntry.tile.key);
      if (!activeEntry || activeEntry.version !== nextEntry.version) {
        continue;
      }

      this.entries.delete(nextEntry.tile.key);
      return nextEntry.tile;
    }

    return undefined;
  }

  remove(tileKey: string): void {
    this.entries.delete(tileKey);
  }

  upsert(tile: MvtTile, priority: number): void {
    const entry = {
      priority,
      sequence: this.nextSequence++,
      tile,
      version: this.nextVersion++,
    } satisfies QueueEntry;

    this.entries.set(tile.key, entry);
    this.heap.push(entry);
  }
}

function compareQueueEntry(left: QueueEntry, right: QueueEntry): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return left.sequence - right.sequence;
}
