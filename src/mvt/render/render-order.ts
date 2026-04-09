import type {
  BackgroundLayerSpecification,
  LayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LayerFamily, SupportedGeometryLayerType } from '../style/layer-family';
import { isSupportedGeometryLayer } from '../style/layer-family';

// 渲染顺序直接镜像样式顺序，不支持的图层会在这里提前过滤掉。
export interface BackgroundRenderEntry {
  kind: 'background';
  layerId: string;
  order: number;
  type: 'background';
}

export interface GeometryRenderEntry {
  familyId: string;
  kind: 'geometry';
  layerId: string;
  order: number;
  sourceId: string;
  sourceLayer?: string;
  type: SupportedGeometryLayerType;
}

export type RenderEntry = BackgroundRenderEntry | GeometryRenderEntry;

export function createRenderOrder(
  style: StyleSpecification,
  layerFamilies: LayerFamily[],
): RenderEntry[] {
  const familyIdsByLayerId = new Map<string, LayerFamily>();
  for (const family of layerFamilies) {
    for (const layerId of family.layerIds) {
      familyIdsByLayerId.set(layerId, family);
    }
  }

  return style.layers.flatMap<RenderEntry>((layer, order) => {
    if (isBackgroundLayer(layer)) {
      return [{
        kind: 'background',
        layerId: layer.id,
        order,
        type: 'background',
      }];
    }

    if (!isSupportedGeometryLayer(layer)) {
      return [];
    }

    const family = familyIdsByLayerId.get(layer.id);
    if (!family) {
      return [];
    }

    return [{
      familyId: family.id,
      kind: 'geometry',
      layerId: layer.id,
      order,
      sourceId: family.sourceId,
      sourceLayer: family.sourceLayer,
      type: family.type,
    }];
  });
}

function isBackgroundLayer(
  layer: LayerSpecification,
): layer is BackgroundLayerSpecification {
  return layer.type === 'background';
}
