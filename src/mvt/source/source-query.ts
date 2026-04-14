import type { FilterSpecification, SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import { createFeatureFilter } from '../style/feature-filter';
import { getSourceLayer, listSourceLayers, parseVectorTile } from './vector-tile';

export interface QuerySourceFeaturesOptions {
  filter?: FilterSpecification | null;
  sourceLayer?: string;
  validate?: boolean;
}

export interface QueryableSourceCache {
  getEntry?: (key: string) => {
    state: string;
    value?: ArrayBuffer;
  } | undefined;
  getLoadedTileKeys: () => string[];
  peekEntryValue?: (key: string) => ArrayBuffer | undefined;
  readonly sourceType: SourceSpecification['type'];
}

interface TileCoordinate {
  level: number;
  x: number;
  y: number;
}

export function querySourceFeaturesFromCache(
  cache: QueryableSourceCache | undefined,
  options: QuerySourceFeaturesOptions = {},
): Feature[] {
  if (!cache) {
    return [];
  }

  const filter = createFeatureFilter(options.filter);
  const features: Feature[] = [];

  for (const tileKey of cache.getLoadedTileKeys()) {
    const entry = cache.getEntry?.(tileKey);
    if (!entry || !(entry.value instanceof ArrayBuffer)) {
      continue;
    }

    const coordinate = parseTileCoordinate(tileKey);
    const tile = parseVectorTile(entry.value);
    const layerNames = cache.sourceType === 'geojson'
      ? listSourceLayers(tile)
      : options.sourceLayer
        ? [options.sourceLayer]
        : listSourceLayers(tile);

    for (const layerName of layerNames) {
      const layer = getSourceLayer(tile, layerName);
      if (!layer) {
        continue;
      }

      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const geometryType = getGeometryType(feature.type);
        if (!geometryType) {
          continue;
        }

        if (!filter({
          geometryType,
          id: feature.id,
          properties: feature.properties as Record<string, unknown>,
          zoom: coordinate.level,
        })) {
          continue;
        }

        features.push(
          feature.toGeoJSON(coordinate.x, coordinate.y, coordinate.level),
        );
      }
    }
  }

  return features;
}

function getGeometryType(type: 0 | 1 | 2 | 3) {
  switch (type) {
    case 1:
      return 'Point';
    case 2:
      return 'LineString';
    case 3:
      return 'Polygon';
    default:
      return undefined;
  }
}

function parseTileCoordinate(key: string): TileCoordinate {
  const scopedKey = key.includes(':')
    ? key.slice(key.indexOf(':') + 1)
    : key;
  const parts = scopedKey.split('/');

  if (parts.length < 4) {
    return {
      level: 0,
      x: 0,
      y: 0,
    };
  }

  const level = Number(parts[parts.length - 3]);
  const x = Number(parts[parts.length - 2]);
  const y = Number(parts[parts.length - 1]);

  if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return {
      level: 0,
      x: 0,
      y: 0,
    };
  }

  return {
    level,
    x,
    y,
  };
}
