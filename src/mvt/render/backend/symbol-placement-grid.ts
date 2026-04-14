export interface SymbolPlacementGridPlacement {
  anchorX: number;
  anchorY: number;
  collision?: {
    blocksOtherSymbols: boolean;
    centerOffsetX: number;
    centerOffsetY: number;
    halfHeight: number;
    halfWidth: number;
    overlapMode: 'always' | 'cooperative' | 'never';
  };
  groupKey?: string;
  lineAngle?: number;
  layerId?: string;
  textAnchor?: string;
  textOffset?: [number, number];
  key: string;
}

export interface SymbolPlacementGrid {
  insert: (placement: SymbolPlacementGridPlacement) => void;
  query: (placement: SymbolPlacementGridPlacement) => SymbolPlacementGridPlacement[];
}

const SYMBOL_PLACEMENT_GRID_DIMENSION = 32;

export function createSymbolPlacementGrid(): SymbolPlacementGrid {
  const placementsByCell = new Map<string, SymbolPlacementGridPlacement[]>();

  return {
    insert(placement: SymbolPlacementGridPlacement): void {
      const collision = placement.collision;
      if (!collision?.blocksOtherSymbols) {
        return;
      }

      for (const cellKey of getCoveredCellKeys(placement)) {
        const cellPlacements = placementsByCell.get(cellKey);
        if (cellPlacements) {
          cellPlacements.push(placement);
        }
        else {
          placementsByCell.set(cellKey, [placement]);
        }
      }
    },
    query(placement: SymbolPlacementGridPlacement): SymbolPlacementGridPlacement[] {
      const collision = placement.collision;
      if (!collision || collision.overlapMode === 'always') {
        return [];
      }

      const candidates = new Set<SymbolPlacementGridPlacement>();
      for (const cellKey of getCoveredCellKeys(placement)) {
        const cellPlacements = placementsByCell.get(cellKey);
        if (!cellPlacements) {
          continue;
        }

        for (const candidate of cellPlacements) {
          candidates.add(candidate);
        }
      }

      return Array.from(candidates);
    },
  };
}

function getCoveredCellKeys(
  placement: SymbolPlacementGridPlacement,
): string[] {
  const bounds = getPlacementBounds(placement);
  if (!bounds) {
    return [];
  }

  const maxCellIndex = SYMBOL_PLACEMENT_GRID_DIMENSION - 1;
  const minCellX = clampCellIndex(
    Math.floor(bounds.minX * SYMBOL_PLACEMENT_GRID_DIMENSION),
    maxCellIndex,
  );
  const maxCellX = clampCellIndex(
    Math.floor(bounds.maxX * SYMBOL_PLACEMENT_GRID_DIMENSION),
    maxCellIndex,
  );
  const minCellY = clampCellIndex(
    Math.floor(bounds.minY * SYMBOL_PLACEMENT_GRID_DIMENSION),
    maxCellIndex,
  );
  const maxCellY = clampCellIndex(
    Math.floor(bounds.maxY * SYMBOL_PLACEMENT_GRID_DIMENSION),
    maxCellIndex,
  );

  const keys: string[] = [];
  for (let y = minCellY; y <= maxCellY; y += 1) {
    for (let x = minCellX; x <= maxCellX; x += 1) {
      keys.push(createCellKey(x, y));
    }
  }

  return keys;
}

function getPlacementBounds(
  placement: SymbolPlacementGridPlacement,
): {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
} | undefined {
  const collision = placement.collision;
  if (!collision) {
    return undefined;
  }

  const centerX = placement.anchorX + collision.centerOffsetX;
  const centerY = placement.anchorY + collision.centerOffsetY;
  return {
    maxX: centerX + collision.halfWidth,
    maxY: centerY + collision.halfHeight,
    minX: centerX - collision.halfWidth,
    minY: centerY - collision.halfHeight,
  };
}

function clampCellIndex(index: number, maxCellIndex: number): number {
  if (index < 0) {
    return 0;
  }

  if (index > maxCellIndex) {
    return maxCellIndex;
  }

  return index;
}

function createCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}
