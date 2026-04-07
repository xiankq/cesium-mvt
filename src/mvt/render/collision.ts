import type { ScreenRect } from '../utils/screen-space';
import { collectScreenGridKeys, intersects } from '../utils/screen-space';

interface StoredLabel {
  rect: ScreenRect;
  cells: string[];
  mode: 'never' | 'always' | 'cooperative';
  blocksPlacement: boolean;
}

export interface LabelCollisionIndexOptions {
  cellSize?: number;
}

export class ScreenLabelCollisionIndex {
  private readonly cellSize: number;
  private readonly placements = new Map<string, StoredLabel>();
  private readonly cells = new Map<string, Set<string>>();

  constructor(options: LabelCollisionIndexOptions = {}) {
    this.cellSize = Math.max(16, options.cellSize ?? 96);
  }

  clear(): void {
    this.placements.clear();
    this.cells.clear();
  }

  remove(labelId: string): void {
    const entry = this.placements.get(labelId);
    if (!entry) {
      return;
    }

    for (const cellKey of entry.cells) {
      const cell = this.cells.get(cellKey);
      if (!cell) {
        continue;
      }

      cell.delete(labelId);
      if (cell.size === 0) {
        this.cells.delete(cellKey);
      }
    }

    this.placements.delete(labelId);
  }

  canPlace(
    rect: ScreenRect,
    mode: 'never' | 'always' | 'cooperative' = 'never',
  ): boolean {
    if (mode === 'always') {
      return true;
    }

    for (const cellKey of this.getCellKeys(rect)) {
      const cell = this.cells.get(cellKey);
      if (!cell) {
        continue;
      }

      for (const labelId of cell) {
        const existing = this.placements.get(labelId);
        if (
          existing
          && existing.blocksPlacement
          && intersects(existing.rect, rect)
        ) {
          if (mode === 'cooperative') {
            if (existing.mode === 'never') {
              return false;
            }
            continue;
          }

          return false;
        }
      }
    }

    return true;
  }

  add(
    labelId: string,
    rect: ScreenRect,
    mode: 'never' | 'always' | 'cooperative' = 'never',
    blocksPlacement = true,
  ): void {
    const cellKeys = this.getCellKeys(rect);
    this.placements.set(labelId, {
      rect,
      cells: cellKeys,
      mode,
      blocksPlacement,
    });

    for (const cellKey of cellKeys) {
      let cell = this.cells.get(cellKey);
      if (!cell) {
        cell = new Set<string>();
        this.cells.set(cellKey, cell);
      }

      cell.add(labelId);
    }
  }

  private getCellKeys(rect: ScreenRect): string[] {
    return collectScreenGridKeys(rect, this.cellSize);
  }
}
