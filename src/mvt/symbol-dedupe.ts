import type { ScreenRect } from './screen-space'
import { collectScreenGridKeys } from './screen-space'
import murmurhash from 'murmurhash-js'

type StoredSymbol = {
  key: string
  hash: number
  cells: string[]
}

export type SymbolDedupeOptions = {
  cellSize?: number
}

export class ScreenSymbolDedupeIndex {
  private readonly cellSize: number
  private readonly placements = new Map<string, StoredSymbol>()
  private readonly cells = new Map<string, Set<string>>()

  constructor(options: SymbolDedupeOptions = {}) {
    this.cellSize = Math.max(16, options.cellSize ?? 128)
  }

  clear(): void {
    this.placements.clear()
    this.cells.clear()
  }

  remove(placementId: string): void {
    const entry = this.placements.get(placementId)
    if (!entry) {
      return
    }

    for (const cellKey of entry.cells) {
      const cell = this.cells.get(cellKey)
      if (!cell) {
        continue
      }

      cell.delete(placementId)
      if (cell.size === 0) {
        this.cells.delete(cellKey)
      }
    }

    this.placements.delete(placementId)
  }

  canPlace(key: string, rect: ScreenRect): boolean {
    if (key.length === 0) {
      return true
    }

    const hash = murmurhash(key)

    for (const cellKey of this.getCellKeys(rect)) {
      const cell = this.cells.get(cellKey)
      if (!cell) {
        continue
      }

      for (const placementId of cell) {
        const existing = this.placements.get(placementId)
        if (existing && existing.hash === hash && existing.key === key) {
          return false
        }
      }
    }

    return true
  }

  add(placementId: string, key: string, rect: ScreenRect): void {
    this.remove(placementId)
    const hash = murmurhash(key)

    const cellKeys = this.getCellKeys(rect)
    this.placements.set(placementId, {
      key,
      hash,
      cells: cellKeys,
    })

    for (const cellKey of cellKeys) {
      let cell = this.cells.get(cellKey)
      if (!cell) {
        cell = new Set<string>()
        this.cells.set(cellKey, cell)
      }

      cell.add(placementId)
    }
  }

  private getCellKeys(rect: ScreenRect): string[] {
    return collectScreenGridKeys(rect, this.cellSize)
  }
}
