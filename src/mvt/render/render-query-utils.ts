import type { SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { TileSpatialIndex } from './tile-spatial-index';
import { GEOJSON_SOURCE_LAYER } from '../source/geojson-source-cache';
import { parseRenderTileCoordinateFromKey, stripRenderTileScope } from './render-tile';

export interface RenderedSymbolPlacement {
  layerId: string;
  renderables: RenderedSymbolRenderable[];
  sourceIndex: number;
  sourceLayer?: string;
}

export interface RenderedSymbolRenderable {
  collection: {
    get: (index: number) => {
      show?: boolean;
    };
  };
  item?: {
    show?: boolean;
  };
  index: number;
  visible?: boolean;
}

export interface RenderedTileCoordinate {
  level: number;
  rawKey: string;
  sourceId: string;
  x: number;
  y: number;
}

export function parseRenderedTileCoordinate(
  renderTileKey: string,
): RenderedTileCoordinate | undefined {
  const rawKey = stripRenderTileScope(renderTileKey);

  try {
    const coordinate = parseRenderTileCoordinateFromKey(rawKey);
    return {
      ...coordinate,
      rawKey,
    };
  }
  catch {
    return undefined;
  }
}

export function resolveSourceLayerNames(
  layer: { source?: string; ['source-layer']?: string },
  source: SourceSpecification | undefined,
  tileIndex: TileSpatialIndex,
): string[] {
  if (typeof layer['source-layer'] === 'string') {
    return [layer['source-layer']];
  }

  if (source?.type === 'geojson') {
    return [GEOJSON_SOURCE_LAYER];
  }

  if (tileIndex.sourceLayerNames?.length) {
    return tileIndex.sourceLayerNames;
  }

  const sourceLayerNames: string[] = [];
  for (const sourceLayerName of tileIndex.layers.keys()) {
    sourceLayerNames.push(sourceLayerName);
  }

  return sourceLayerNames;
}

export function getVisibleSymbolSourceIndexes(
  handle: {
    symbols?: {
      placements: RenderedSymbolPlacement[];
      visibleSourceIndexesByLayerAndSourceLayer?: Map<string, Map<string, Set<number>>>;
    };
  },
  layerId: string,
  sourceLayerName: string,
): Set<number> {
  const cachedVisibleSourceIndexes = handle.symbols?.visibleSourceIndexesByLayerAndSourceLayer
    ?.get(layerId)
    ?.get(sourceLayerName);
  if (cachedVisibleSourceIndexes) {
    return cachedVisibleSourceIndexes;
  }

  const placements = handle.symbols?.placements;
  if (!placements?.length) {
    return new Set();
  }

  const visibleSourceIndexes = new Set<number>();
  for (const placement of placements) {
    if (placement.layerId !== layerId || placement.sourceLayer !== sourceLayerName) {
      continue;
    }

    if (isSymbolPlacementVisible(placement)) {
      visibleSourceIndexes.add(placement.sourceIndex);
    }
  }

  return visibleSourceIndexes;
}

export function isSymbolPlacementVisible(placement: RenderedSymbolPlacement): boolean {
  return placement.renderables.some((renderable) => {
    if (renderable.visible !== undefined) {
      return renderable.visible;
    }

    if (renderable.item) {
      return renderable.item.show !== false;
    }

    return renderable.collection.get(renderable.index).show !== false;
  });
}
