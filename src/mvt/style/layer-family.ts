import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { GEOJSON_SOURCE_LAYER } from '../source/geojson-source-cache';

export function isLayerVisibleAtZoom(
  layer: LayerSpecification,
  zoom: number,
) {
  if (layer.layout?.visibility === 'none') {
    return false;
  }

  const minzoom = typeof layer.minzoom === 'number'
    ? layer.minzoom
    : Number.NEGATIVE_INFINITY;
  const maxzoom = typeof layer.maxzoom === 'number'
    ? layer.maxzoom
    : Number.POSITIVE_INFINITY;

  return zoom >= minzoom && zoom < maxzoom;
}

export type SupportedGeometryLayer
  = | CircleLayerSpecification
    | FillLayerSpecification
    | LineLayerSpecification;

export type SupportedGeometryLayerType = SupportedGeometryLayer['type'];

export interface LayerFamily {
  id: string;
  layerIds: string[];
  sourceId: string;
  sourceLayer?: string;
  type: SupportedGeometryLayerType;
}

export function createLayerFamilies(style: StyleSpecification): LayerFamily[] {
  const families: LayerFamily[] = [];
  let currentFamily: LayerFamily | undefined;
  let currentLayoutKey: string | undefined;

  for (const layer of style.layers) {
    if (!isSupportedGeometryLayer(layer)) {
      currentFamily = undefined;
      currentLayoutKey = undefined;
      continue;
    }

    const nextLayoutKey = createLayoutKey(layer.layout);
    const sourceId = layer.source;
    const sourceLayer = resolveSourceLayer(style.sources[layer.source], layer);
    const compatibleWithCurrent = currentFamily
      && currentFamily.sourceId === sourceId
      && currentFamily.sourceLayer === sourceLayer
      && currentFamily.type === layer.type
      && currentLayoutKey === nextLayoutKey;

    if (compatibleWithCurrent && currentFamily) {
      currentFamily.layerIds.push(layer.id);
      continue;
    }

    currentFamily = {
      id: `${sourceId}/${sourceLayer ?? '_'}/${layer.type}/${families.length}`,
      layerIds: [layer.id],
      sourceId,
      sourceLayer,
      type: layer.type,
    };
    currentLayoutKey = nextLayoutKey;
    families.push(currentFamily);
  }

  return families;
}

export function isSupportedGeometryLayer(
  layer: LayerSpecification,
): layer is SupportedGeometryLayer {
  return layer.type === 'fill'
    || layer.type === 'line'
    || layer.type === 'circle';
}

function createLayoutKey(layout: unknown) {
  return stableSerialize(layout ?? {});
}

function resolveSourceLayer(
  source: SourceSpecification | undefined,
  layer: SupportedGeometryLayer,
) {
  if (typeof layer['source-layer'] === 'string') {
    return layer['source-layer'];
  }

  if (source?.type === 'geojson') {
    // GeoJSON 天生没有 source-layer 概念，这里补一个合成值，
    // 让下游查找逻辑和普通向量瓦片保持一致。
    return GEOJSON_SOURCE_LAYER;
  }

  return undefined;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    // layout 兼容性必须忽略 key 顺序，
    // 否则语义相同的对象会被错误拆成多个 family，造成重复工作。
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${key}:${stableSerialize(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}
