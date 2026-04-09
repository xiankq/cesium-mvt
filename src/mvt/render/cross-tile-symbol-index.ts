import type { TileCoordinate } from '../types';

const EXTENT = 4096;
const ROUNDING_FACTOR = 512 / EXTENT / 2;

interface SymbolKey {
  layerId: string;
  text?: string;
  image?: string;
}

interface SymbolEntry {
  crossTileID: number;
  tileCoordinate: TileCoordinate;
  tileX: number;
  tileY: number;
}

interface TileLayerIndex {
  tileCoordinate: TileCoordinate;
  symbols: Map<string, SymbolEntry[]>;
}

export class CrossTileSymbolIndex {
  private readonly layerIndexes: Map<string, Map<string, TileLayerIndex>> = new Map();
  private maxCrossTileID = 0;
  private readonly usedCrossTileIDs: Map<number, Set<number>> = new Map();

  generateCrossTileID(): number {
    return ++this.maxCrossTileID;
  }

  addTileSymbols(
    tileCoordinate: TileCoordinate,
    layerId: string,
    symbols: Array<{
      key: SymbolKey;
      tileX: number;
      tileY: number;
    }>,
  ): Map<number, number> {
    const crossTileIDMap = new Map<number, number>();

    if (!this.layerIndexes.has(layerId)) {
      this.layerIndexes.set(layerId, new Map());
    }

    const layerIndex = this.layerIndexes.get(layerId)!;
    const tileKey = this.getTileKey(tileCoordinate);

    if (!this.usedCrossTileIDs.has(tileCoordinate.z)) {
      this.usedCrossTileIDs.set(tileCoordinate.z, new Set());
    }
    const zoomCrossTileIDs = this.usedCrossTileIDs.get(tileCoordinate.z)!;

    const tileLayerIndex: TileLayerIndex = {
      symbols: new Map(),
      tileCoordinate,
    };

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const keyString = this.keyToString(symbol.key);

      let matched = false;

      for (const [existingTileKey, existingIndex] of layerIndex) {
        if (existingTileKey === tileKey)
          continue;

        const existingSymbols = existingIndex.symbols.get(keyString);
        if (!existingSymbols)
          continue;

        const tolerance = this.getTolerance(existingIndex.tileCoordinate, tileCoordinate);

        for (const existingSymbol of existingSymbols) {
          const scaledCoord = this.getScaledCoordinates(
            existingSymbol.tileX,
            existingSymbol.tileY,
            existingIndex.tileCoordinate,
            tileCoordinate,
          );

          const dx = Math.abs(scaledCoord.x - symbol.tileX);
          const dy = Math.abs(scaledCoord.y - symbol.tileY);

          if (dx <= tolerance && dy <= tolerance && !zoomCrossTileIDs.has(existingSymbol.crossTileID)) {
            crossTileIDMap.set(i, existingSymbol.crossTileID);
            zoomCrossTileIDs.add(existingSymbol.crossTileID);
            matched = true;
            break;
          }
        }

        if (matched)
          break;
      }

      if (!matched) {
        const crossTileID = this.generateCrossTileID();
        crossTileIDMap.set(i, crossTileID);
        zoomCrossTileIDs.add(crossTileID);
      }

      if (!tileLayerIndex.symbols.has(keyString)) {
        tileLayerIndex.symbols.set(keyString, []);
      }

      tileLayerIndex.symbols.get(keyString)!.push({
        crossTileID: crossTileIDMap.get(i)!,
        tileCoordinate,
        tileX: symbol.tileX,
        tileY: symbol.tileY,
      });
    }

    layerIndex.set(tileKey, tileLayerIndex);

    return crossTileIDMap;
  }

  removeTile(tileCoordinate: TileCoordinate, layerId: string): void {
    const layerIndex = this.layerIndexes.get(layerId);
    if (!layerIndex)
      return;

    const tileKey = this.getTileKey(tileCoordinate);
    const tileLayerIndex = layerIndex.get(tileKey);
    if (!tileLayerIndex)
      return;

    const zoomCrossTileIDs = this.usedCrossTileIDs.get(tileCoordinate.z);
    if (zoomCrossTileIDs) {
      for (const symbols of tileLayerIndex.symbols.values()) {
        for (const symbol of symbols) {
          zoomCrossTileIDs.delete(symbol.crossTileID);
        }
      }
    }

    layerIndex.delete(tileKey);
  }

  private getTileKey(coord: TileCoordinate): string {
    return `${coord.z}:${coord.x}:${coord.y}`;
  }

  private keyToString(key: SymbolKey): string {
    return `${key.layerId}:${key.text ?? ''}:${key.image ?? ''}`;
  }

  private getTolerance(coord1: TileCoordinate, coord2: TileCoordinate): number {
    if (coord1.z < coord2.z) {
      return 1;
    }
    return 2 ** (coord1.z - coord2.z);
  }

  private getScaledCoordinates(
    tileX: number,
    tileY: number,
    sourceCoord: TileCoordinate,
    targetCoord: TileCoordinate,
  ): { x: number; y: number } {
    const zDiff = targetCoord.z - sourceCoord.z;
    const scale = ROUNDING_FACTOR / (2 ** zDiff);

    const xWorld = (targetCoord.x * EXTENT + tileX) * scale;
    const yWorld = (targetCoord.y * EXTENT + tileY) * scale;

    const xOffset = sourceCoord.x * EXTENT * ROUNDING_FACTOR;
    const yOffset = sourceCoord.y * EXTENT * ROUNDING_FACTOR;

    return {
      x: Math.floor(xWorld - xOffset),
      y: Math.floor(yWorld - yOffset),
    };
  }
}
