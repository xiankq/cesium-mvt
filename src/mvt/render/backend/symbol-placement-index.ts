import { isSymbolOverlapAllowed } from './symbol-placement-utils';

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
  groupKey?: string;
  key: string;
  level: number;
  tileKey: string;
}

export interface SymbolPlacementIndex {
  hasMatch: (placement: SymbolPlacementIndexPlacement) => boolean;
  insert: (placement: SymbolPlacementIndexPlacement) => void;
}

const SYMBOL_MATCH_GRID_SIZE = 4;
const SYMBOL_MATCH_MAX_RADIUS = 4;

interface PlacementIndexLevel {
  anchorCells: Map<string, SymbolPlacementIndexPlacement[]>;
  collisionCells: Map<string, SymbolPlacementIndexPlacement[]>;
}

export function createSymbolPlacementIndex(options: {
  tileWidth?: number;
} = {}): SymbolPlacementIndex {
  const tileWidth = options.tileWidth ?? 256;
  const placementsByKey = new Map<string, Map<number, PlacementIndexLevel>>();
  const placementsByLevel = new Map<number, PlacementIndexLevel>();
  const claimedKeyMatches = new Set<SymbolPlacementIndexPlacement>();

  return {
    hasMatch(placement: SymbolPlacementIndexPlacement): boolean {
      if (placement.collision?.overlapMode === 'always') {
        return false;
      }

      const keyIndex = placementsByKey.get(placement.key);
      if (keyIndex) {
        const candidate = findUnclaimedKeyMatch(
          keyIndex,
          placement,
          tileWidth,
          claimedKeyMatches,
        );
        if (candidate) {
          claimedKeyMatches.add(candidate);
          return true;
        }
      }

      for (const [candidateLevel, levelIndex] of placementsByLevel) {
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
      insertPlacementIntoLevelIndex(
        getOrCreateLevelIndex(keyIndex, placement.level),
        placement,
      );

      const levelIndex = getOrCreateLevelIndex(placementsByLevel, placement.level);
      insertPlacementIntoLevelIndex(levelIndex, placement);
    },
  };
}

function findUnclaimedKeyMatch(
  keyIndex: Map<number, PlacementIndexLevel>,
  placement: SymbolPlacementIndexPlacement,
  tileWidth: number,
  claimedKeyMatches: Set<SymbolPlacementIndexPlacement>,
): SymbolPlacementIndexPlacement | undefined {
  for (const [candidateLevel, levelIndex] of keyIndex) {
    const candidates = collectCandidates(levelIndex, placement, candidateLevel);
    for (const candidate of candidates) {
      if (candidate.tileKey === placement.tileKey) {
        continue;
      }

      if (claimedKeyMatches.has(candidate)) {
        continue;
      }

      if (isKeyMatchedSymbolPlacement(candidate, placement, tileWidth)) {
        return candidate;
      }
    }
  }

  return undefined;
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

function getPlacementGridPoint(
  placement: SymbolPlacementIndexPlacement,
  referenceLevel: number,
  tileWidth: number,
): {
  x: number;
  y: number;
} {
  const scale = (2 ** referenceLevel) * tileWidth / SYMBOL_MATCH_GRID_SIZE;
  return {
    x: Math.floor(placement.anchorX * scale),
    y: Math.floor(placement.anchorY * scale),
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
    return 1;
  }

  return Math.min(
    SYMBOL_MATCH_MAX_RADIUS,
    2 ** (candidateLevel - placementLevel),
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
  if (!candidate.collision?.blocksOtherSymbols || !placement.collision) {
    return false;
  }

  if (candidate.groupKey && placement.groupKey && candidate.groupKey === placement.groupKey) {
    return false;
  }

  if (isSymbolOverlapAllowed(placement.collision.overlapMode, candidate.collision.overlapMode)) {
    return false;
  }

  if (hasMatchingCollision(candidate, placement)) {
    return true;
  }

  return false;
}

function isKeyMatchedSymbolPlacement(
  candidate: SymbolPlacementIndexPlacement,
  placement: SymbolPlacementIndexPlacement,
  tileWidth: number,
): boolean {
  if (!candidate.collision || !placement.collision) {
    return false;
  }

  if (candidate.groupKey && placement.groupKey && candidate.groupKey === placement.groupKey) {
    return false;
  }

  if (isSymbolOverlapAllowed(placement.collision.overlapMode, candidate.collision.overlapMode)) {
    return false;
  }

  const candidatePoint = getPlacementGridPoint(candidate, placement.level, tileWidth);
  const placementPoint = getPlacementGridPoint(placement, placement.level, tileWidth);
  const tolerance = getPlacementTolerance(candidate.level, placement.level);
  return Math.abs(candidatePoint.x - placementPoint.x) <= tolerance
    && Math.abs(candidatePoint.y - placementPoint.y) <= tolerance;
}

function insertPlacementIntoLevelIndex(
  levelIndex: PlacementIndexLevel,
  placement: SymbolPlacementIndexPlacement,
): void {
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

function hasMatchingCollision(
  candidate: SymbolPlacementIndexPlacement,
  placement: SymbolPlacementIndexPlacement,
): boolean {
  const candidateCollision = candidate.collision;
  const placementCollision = placement.collision;
  if (!candidateCollision || !placementCollision) {
    return false;
  }

  const candidateCenterX = candidate.anchorX + candidateCollision.centerOffsetX;
  const candidateCenterY = candidate.anchorY + candidateCollision.centerOffsetY;
  const placementCenterX = placement.anchorX + placementCollision.centerOffsetX;
  const placementCenterY = placement.anchorY + placementCollision.centerOffsetY;

  const deltaX = Math.abs(candidateCenterX - placementCenterX);
  const deltaY = Math.abs(candidateCenterY - placementCenterY);
  return deltaX <= candidateCollision.halfWidth + placementCollision.halfWidth
    && deltaY <= candidateCollision.halfHeight + placementCollision.halfHeight;
}

function getOrCreateLevelIndex(
  placementsByLevel: Map<number, PlacementIndexLevel>,
  level: number,
): PlacementIndexLevel {
  const levelIndex = placementsByLevel.get(level);
  if (levelIndex) {
    return levelIndex;
  }

  const nextLevelIndex: PlacementIndexLevel = {
    anchorCells: new Map<string, SymbolPlacementIndexPlacement[]>(),
    collisionCells: new Map<string, SymbolPlacementIndexPlacement[]>(),
  };
  placementsByLevel.set(level, nextLevelIndex);
  return nextLevelIndex;
}

function createCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}
