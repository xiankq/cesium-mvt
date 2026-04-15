import type { FilterSpecification, SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import type { Feature as StyleFeature } from '../style/filter-adapter';
import { parseRenderTileCoordinateFromKey } from '../render/render-tile';
import { createFeatureFilter } from '../style/filter-adapter';
import { getSourceLayer, listSourceLayers, parseVectorTile } from './vector-tile';

export interface QuerySourceFeaturesOptions {
  filter?: FilterSpecification | null;
  sourceLayer?: string;
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
    if (!entry) {
      continue;
    }

    // 优先读取未克隆的原始 buffer，保证 source 查询与渲染查询共享同一份解析快照。
    const tileData = cache.peekEntryValue?.(tileKey) ?? entry.value;
    if (!(tileData instanceof ArrayBuffer)) {
      continue;
    }

    let coordinate: ReturnType<typeof parseRenderTileCoordinateFromKey> | undefined;
    try {
      coordinate = parseRenderTileCoordinateFromKey(tileKey);
    }
    catch {
      continue;
    }
    if (!coordinate) {
      continue;
    }
    const tile = parseVectorTile(tileData);
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

        const filterFeature: StyleFeature = {
          id: feature.id,
          properties: feature.properties as Record<string, unknown>,
          type: geometryType,
        };
        if (!filter({
          feature: filterFeature,
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

function getGeometryType(type: 0 | 1 | 2 | 3): StyleFeature['type'] | undefined {
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
