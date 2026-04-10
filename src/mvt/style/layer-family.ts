import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { GEOJSON_SOURCE_LAYER } from '../source/geojson-source-cache';

// layer family 用来归并兼容的几何图层，复用同一份解析后的几何批次。
export type SupportedGeometryLayer
  = | CircleLayerSpecification
    | FillLayerSpecification
    | LineLayerSpecification;

export type SupportedGeometryLayerType = SupportedGeometryLayer['type'];

export interface LayerFamily {
  id: string;
  filter?: FilterSpecification;
  layerIds: string[];
  sourceId: string;
  sourceLayer?: string;
  type: SupportedGeometryLayerType;
}

// MapLibre 会按 source / source-layer / type / layout / filter 的兼容签名复用 bucket，
// 这样同一份几何只需要解析一次，再由多个 style layer 复用。
export function createLayerFamilies(style: StyleSpecification): LayerFamily[] {
  const families: LayerFamily[] = [];
  const familiesBySignature = new Map<string, LayerFamily>();

  for (const layer of style.layers) {
    if (!isSupportedGeometryLayer(layer)) {
      continue;
    }

    const sourceId = layer.source;
    const sourceLayer = resolveSourceLayer(style.sources[layer.source], layer);
    const signature = createFamilySignature({
      filter: layer.filter,
      layout: layer.layout,
      sourceId,
      sourceLayer,
      type: layer.type,
    });

    const existingFamily = familiesBySignature.get(signature);
    if (existingFamily) {
      existingFamily.layerIds.push(layer.id);
      continue;
    }

    const family: LayerFamily = {
      id: `${sourceId}/${sourceLayer ?? '_'}/${layer.type}/${families.length}`,
      layerIds: [layer.id],
      sourceId,
      sourceLayer,
      type: layer.type,
    };
    if (layer.filter !== undefined) {
      family.filter = layer.filter;
    }

    familiesBySignature.set(signature, family);
    families.push(family);
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

function createFamilySignature(options: {
  filter: FilterSpecification | undefined;
  layout: unknown;
  sourceId: string;
  sourceLayer: string | undefined;
  type: SupportedGeometryLayerType;
}) {
  return stableSerialize({
    filter: options.filter ?? null,
    layout: options.layout ?? {},
    sourceId: options.sourceId,
    sourceLayer: options.sourceLayer ?? null,
    type: options.type,
  });
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
    // 签名必须忽略 key 顺序，
    // 否则语义相同的对象会被错误拆成多个 family，造成重复工作。
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${key}:${stableSerialize(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}
