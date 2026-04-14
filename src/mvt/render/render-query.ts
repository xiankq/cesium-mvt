import type { FilterSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { SupportedGeometryLayer } from '../style/layer-family';
import type { RenderedSymbolPlacement } from './render-query-utils';
import type { RenderQueryGeometry } from './tile-spatial-index';
import { createFeatureFilter } from '../style/filter-adapter';
import { isLayerVisibleAtZoom, isSupportedGeometryLayer } from '../style/layer-family';
import {
  getVisibleSymbolSourceIndexes,
  parseRenderedTileCoordinate,

  resolveSourceLayerNames,
} from './render-query-utils';
import { getTileSpatialIndex, querySpatialLayer } from './tile-spatial-index';

export interface RenderedFeature extends Feature {
  layerId: string;
  sourceId: string;
  sourceLayer?: string;
}

export interface QueryRenderedFeaturesOptions {
  filter?: FilterSpecification | null;
  geometry?: RenderQueryGeometry;
  layers?: string[];
}

export interface QueryRenderedFeaturesState {
  getFeatureState?: FeatureStateResolver;
  getSourceCache: (sourceId: string) => RenderedSourceCache | undefined;
  renderManager: {
    getAllKeys: () => string[];
    getHandle: (key: string) => {
      visible: boolean;
      symbols?: {
        placements: RenderedSymbolPlacement[];
      };
    } | undefined;
  };
  style?: StyleSpecification;
}

interface RenderableLayerEntry {
  filter: ReturnType<typeof createFeatureFilter>;
  layer: SupportedGeometryLayer;
  source?: SourceSpecification;
}

interface RenderedSourceCache {
  getEntry?: (key: string) => {
    state: string;
    value?: ArrayBuffer;
  } | undefined;
  peekEntryValue?: (key: string) => ArrayBuffer | undefined;
}

export function queryRenderedFeaturesFromState(
  state: QueryRenderedFeaturesState,
  options: QueryRenderedFeaturesOptions = {},
): RenderedFeature[] {
  if (!state.style) {
    return [];
  }

  const layerIds = options.layers?.length
    ? new Set(options.layers)
    : undefined;
  const queryFilter = createFeatureFilter(options.filter);
  const renderableLayers = createRenderableLayerEntries(state.style, layerIds);
  const features: RenderedFeature[] = [];

  for (const renderTileKey of state.renderManager.getAllKeys()) {
    const handle = state.renderManager.getHandle(renderTileKey);
    if (!handle?.visible) {
      continue;
    }

    const coordinate = parseRenderedTileCoordinate(renderTileKey);
    if (!coordinate) {
      continue;
    }

    const sourceCache = state.getSourceCache(coordinate.sourceId);
    const entry = sourceCache?.getEntry?.(coordinate.rawKey);
    if (!entry || !(entry.value instanceof ArrayBuffer)) {
      continue;
    }

    const tileData = sourceCache?.peekEntryValue?.(coordinate.rawKey) ?? entry.value;
    const tileIndex = getTileSpatialIndex(tileData);

    for (const layerEntry of renderableLayers) {
      const layer = layerEntry.layer;
      if (layer.source !== coordinate.sourceId) {
        continue;
      }

      if (!isLayerVisibleAtZoom(layer, coordinate.level)) {
        continue;
      }

      const sourceLayerNames = resolveSourceLayerNames(layer, layerEntry.source, tileIndex);
      if (sourceLayerNames.length === 0) {
        continue;
      }

      for (const sourceLayerName of sourceLayerNames) {
        const sourceLayerIndex = tileIndex.layers.get(sourceLayerName);
        if (!sourceLayerIndex) {
          continue;
        }

        const visibleSymbolSourceIndexes = layer.type === 'symbol'
          ? getVisibleSymbolSourceIndexes(handle, layer.id, sourceLayerName)
          : new Set<number>();
        if (layer.type === 'symbol' && visibleSymbolSourceIndexes.size === 0) {
          continue;
        }

        for (const candidate of querySpatialLayer(sourceLayerIndex, options.geometry)) {
          if (layer.type === 'symbol' && !visibleSymbolSourceIndexes.has(candidate.sourceIndex)) {
            continue;
          }

          const featureState = state.getFeatureState?.({
            id: candidate.feature.id,
            sourceId: coordinate.sourceId,
            sourceLayer: sourceLayerName,
          });
          const feature = {
            id: candidate.feature.id,
            properties: candidate.feature.properties ?? {},
            type: candidate.geometryType,
          };
          const context = {
            feature,
            featureState,
            geometryType: candidate.geometryType,
            id: candidate.feature.id,
            properties: candidate.feature.properties ?? {},
            zoom: coordinate.level,
          };

          if (!layerEntry.filter(context) || !queryFilter(context)) {
            continue;
          }

          features.push({
            ...candidate.feature.toGeoJSON(
              coordinate.x,
              coordinate.y,
              coordinate.level,
            ),
            id: candidate.feature.id,
            layerId: layer.id,
            sourceId: coordinate.sourceId,
            sourceLayer: sourceLayerName,
          });
        }
      }
    }
  }

  return features;
}

function createRenderableLayerEntries(
  style: StyleSpecification,
  layerIds?: Set<string>,
): RenderableLayerEntry[] {
  return style.layers.flatMap((layer) => {
    if (layerIds && !layerIds.has(layer.id)) {
      return [];
    }

    if (!isSupportedGeometryLayer(layer)) {
      return [];
    }

    const source = style.sources[layer.source];
    if (!source) {
      return [];
    }

    return [{
      filter: createFeatureFilter(layer.filter),
      layer,
      source,
    }];
  });
}
