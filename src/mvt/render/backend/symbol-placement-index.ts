export interface SymbolPlacementIndexCollision {
  blocksOtherSymbols: boolean;
  centerOffsetX: number;
  centerOffsetY: number;
  halfHeight: number;
  halfWidth: number;
  overlapMode: 'always' | 'cooperative' | 'never';
}

export interface SymbolPlacementIndexPlacement {
  anchorX: number;
  anchorY: number;
  collision?: SymbolPlacementIndexCollision;
  key: string;
  level: number;
}

export interface SymbolPlacementIndex {
  hasMatch: (placement: SymbolPlacementIndexPlacement) => boolean;
  insert: (placement: SymbolPlacementIndexPlacement) => void;
}

const SYMBOL_MATCH_TOLERANCE = 1;
const SYMBOL_MATCH_MAX_RADIUS = 4;

interface PlacementIndexLevel {
  anchorCells: Map<string, SymbolPlacementIndexPlacement[]>;
  collisionCells: Map<string, SymbolPlacementIndexPlacement[]>;
}

export function createSymbolPlacementIndex(): SymbolPlacementIndex {
  const placementsByKey = new Map<string, Map<number, PlacementIndexLevel>>();

  return {
    hasMatch(placement: SymbolPlacementIndexPlacement): boolean {
      if (placement.collision?.overlapMode === 'always') {
        return false;
      }

      const keyIndex = placementsByKey.get(placement.key);
      if (!keyIndex) {
        return false;
      }

      for (const [candidateLevel, levelIndex] of keyIndex) {
        const candidates = collectCandidates(levelIndex, placement, candidateLevel);
        for (const candidate of candidates) {
          if (isMatchingSymbolPlacement(candidate, placement)) {
            return true;
          }
        }
      }

      return false;
    },
    insert(placement: SymbolPlacementIndexPlacement): void {
      const collision = placement.collision;
      if (!collision?.blocksOtherSymbols) {
        return;
      }

      const keyIndex = getOrCreateKeyIndex(placementsByKey, placement.key);
      const levelIndex = getOrCreateLevelIndex(keyIndex, placement.level);

      for (const cellKey of getAnchorCellKeys(placement)) {
        const cellPlacements = levelIndex.anchorCells.get(cellKey);
        if (cellPlacements) {
          cellPlacements.push(placement);
        }
        else {
          levelIndex.anchorCells.set(cellKey, [placement]);
        }
      }

      for (const cellKey of getCollisionCellKeys(placement)) {
        const cellPlacements = levelIndex.collisionCells.get(cellKey);
        if (cellPlacements) {
          cellPlacements.push(placement);
        }
        else {
          levelIndex.collisionCells.set(cellKey, [placement]);
        }
      }
    },
  };
}

function collectCandidates(
  levelIndex: PlacementIndexLevel,
  placement: SymbolPlacementIndexPlacement,
  candidateLevel: number,
): SymbolPlacementIndexPlacement[] {
  const candidates = new Set<SymbolPlacementIndexPlacement>();

  for (const cellKey of getAnchorSearchCellKeys(placement, candidateLevel)) {
    const cellPlacements = levelIndex.anchorCells.get(cellKey);
    if (!cellPlacements) {
      continue;
    }

    for (const candidate of cellPlacements) {
      candidates.add(candidate);
    }
  }

  for (const cellKey of getCollisionSearchCellKeys(placement, candidateLevel)) {
    const cellPlacements = levelIndex.collisionCells.get(cellKey);
    if (!cellPlacements) {
      continue;
    }

    for (const candidate of cellPlacements) {
      candidates.add(candidate);
    }
  }

  return Array.from(candidates);
}

function getAnchorCellKeys(
  placement: SymbolPlacementIndexPlacement,
): string[] {
  const scale = getPlacementScale(placement.level);
  return getCellKeysAroundPoint(
    placement.anchorX * scale,
    placement.anchorY * scale,
    1,
  );
}

function getAnchorSearchCellKeys(
  placement: SymbolPlacementIndexPlacement,
  candidateLevel: number,
): string[] {
  const scale = getPlacementScale(candidateLevel);
  const tolerance = getPlacementTolerance(candidateLevel, placement.level);
  return getCellKeysAroundPoint(
    placement.anchorX * scale,
    placement.anchorY * scale,
    Math.min(SYMBOL_MATCH_MAX_RADIUS, tolerance + 1),
  );
}

function getCollisionCellKeys(
  placement: SymbolPlacementIndexPlacement,
): string[] {
  const center = getPlacementCenter(placement);
  if (!center) {
    return [];
  }

  const scale = getPlacementScale(placement.level);
  const centerX = center.centerX * scale;
  const centerY = center.centerY * scale;
  const radius = Math.min(
    SYMBOL_MATCH_MAX_RADIUS,
    Math.max(
      0,
      Math.ceil(Math.max(center.halfWidth, center.halfHeight) * scale),
    ),
  );
  return getCellKeysAroundPoint(centerX, centerY, radius);
}

function getCollisionSearchCellKeys(
  placement: SymbolPlacementIndexPlacement,
  candidateLevel: number,
): string[] {
  const center = getPlacementCenter(placement);
  if (!center) {
    return [];
  }

  const scale = getPlacementScale(candidateLevel);
  const centerX = center.centerX * scale;
  const centerY = center.centerY * scale;
  const radius = Math.min(
    SYMBOL_MATCH_MAX_RADIUS,
    Math.max(
      0,
      Math.ceil(Math.max(center.halfWidth, center.halfHeight) * scale)
      + getPlacementTolerance(candidateLevel, placement.level),
    ),
  );
  return getCellKeysAroundPoint(centerX, centerY, radius);
}

function getPlacementCenter(
  placement: SymbolPlacementIndexPlacement,
): {
  centerX: number;
  centerY: number;
  halfHeight: number;
  halfWidth: number;
} | undefined {
  const collision = placement.collision;
  if (!collision) {
    return undefined;
  }

  return {
    centerX: placement.anchorX + collision.centerOffsetX,
    centerY: placement.anchorY + collision.centerOffsetY,
    halfHeight: collision.halfHeight,
    halfWidth: collision.halfWidth,
  };
}

function getPlacementScale(level: number): number {
  return 2 ** level;
}

function getPlacementTolerance(
  candidateLevel: number,
  placementLevel: number,
): number {
  if (candidateLevel < placementLevel) {
    return SYMBOL_MATCH_TOLERANCE;
  }

  return Math.min(
    SYMBOL_MATCH_MAX_RADIUS,
    SYMBOL_MATCH_TOLERANCE * 2 ** (candidateLevel - placementLevel),
  );
}

function getCellKeysAroundPoint(
  pointX: number,
  pointY: number,
  radius: number,
): string[] {
  const centerCellX = Math.floor(pointX);
  const centerCellY = Math.floor(pointY);
  const minCellX = centerCellX - radius;
  const maxCellX = centerCellX + radius;
  const minCellY = centerCellY - radius;
  const maxCellY = centerCellY + radius;

  const keys: string[] = [];
  for (let y = minCellY; y <= maxCellY; y += 1) {
    for (let x = minCellX; x <= maxCellX; x += 1) {
      keys.push(createCellKey(x, y));
    }
  }

  return keys;
}

function isMatchingSymbolPlacement(
  candidate: SymbolPlacementIndexPlacement,
  placement: SymbolPlacementIndexPlacement,
): boolean {
  if (candidate.collision && placement.collision) {
    return hasMatchingCollision(candidate, placement);
  }

  if (hasMatchingCollision(candidate, placement)) {
    return true;
  }

  const scale = getPlacementScale(candidate.level);
  const tolerance = getPlacementTolerance(candidate.level, placement.level);
  return Math.abs(candidate.anchorX * scale - placement.anchorX * scale) <= tolerance
    && Math.abs(candidate.anchorY * scale - placement.anchorY * scale) <= tolerance;
}

function hasMatchingCollision(
  candidate: SymbolPlacementIndexPlacement,
  placement: SymbolPlacementIndexPlacement,
): boolean {
  if (!candidate.collision?.blocksOtherSymbols || !placement.collision) {
    return false;
  }

  const candidateCenterX = candidate.anchorX + candidate.collision.centerOffsetX;
  const candidateCenterY = candidate.anchorY + candidate.collision.centerOffsetY;
  const placementCenterX = placement.anchorX + placement.collision.centerOffsetX;
  const placementCenterY = placement.anchorY + placement.collision.centerOffsetY;

  const deltaX = Math.abs(candidateCenterX - placementCenterX);
  const deltaY = Math.abs(candidateCenterY - placementCenterY);
  return deltaX <= candidate.collision.halfWidth + placement.collision.halfWidth
    && deltaY <= candidate.collision.halfHeight + placement.collision.halfHeight;
}

function getOrCreateKeyIndex(
  placementsByKey: Map<string, Map<number, PlacementIndexLevel>>,
  key: string,
): Map<number, PlacementIndexLevel> {
  const keyIndex = placementsByKey.get(key);
  if (keyIndex) {
    return keyIndex;
  }

  const nextKeyIndex = new Map<number, PlacementIndexLevel>();
  placementsByKey.set(key, nextKeyIndex);
  return nextKeyIndex;
}

function getOrCreateLevelIndex(
  keyIndex: Map<number, PlacementIndexLevel>,
  level: number,
): PlacementIndexLevel {
  const levelIndex = keyIndex.get(level);
  if (levelIndex) {
    return levelIndex;
  }

  const nextLevelIndex: PlacementIndexLevel = {
    anchorCells: new Map<string, SymbolPlacementIndexPlacement[]>(),
    collisionCells: new Map<string, SymbolPlacementIndexPlacement[]>(),
  };
  keyIndex.set(level, nextLevelIndex);
  return nextLevelIndex;
}

function createCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}
