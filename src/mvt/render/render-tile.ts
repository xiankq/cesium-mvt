import type {
  BackgroundLayerSpecification,
  FilterSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LayerFamily, SupportedGeometryLayerType } from '../style/layer-family';
import type { RenderEntry } from './render-order';
import { isLayerVisibleAtZoom } from '../style/layer-visibility';

// RenderTile 表示某个 source tile 在当前 styleEpoch 下的渲染计划，
// 此时还没有真正构建出可提交给 Cesium 的几何资源。
export interface BackgroundBatch {
  color?: string;
  layerId: string;
  order: number;
}

export interface GeometryBatch {
  backend: SupportedGeometryLayerType;
  filter?: FilterSpecification;
  familyId: string;
  layerIds: string[];
  order: number;
  sourceId: string;
  sourceLayer?: string;
  type: SupportedGeometryLayerType;
}

export interface RenderTile {
  background?: BackgroundBatch;
  epoch: number;
  geometryBatches: GeometryBatch[];
  key: string;
}

export interface CompileRenderTileOptions {
  key: string;
  layerFamilies: LayerFamily[];
  renderOrder: RenderEntry[];
  style: StyleSpecification;
  styleEpoch: number;
}

export function createRenderTileKey(
  sourceId: string,
  level: number,
  x: number,
  y: number,
) {
  return `${sourceId}/${level}/${x}/${y}`;
}

export function createScopedRenderTileKey(
  key: string,
  styleEpoch: number,
) {
  return `${key}@${styleEpoch}`;
}

export function compileRenderTile({
  key,
  layerFamilies,
  renderOrder,
  style,
  styleEpoch,
}: CompileRenderTileOptions): RenderTile {
  const coordinate = parseRenderTileCoordinateFromKey(key);
  const familiesById = new Map(layerFamilies.map(family => [family.id, family]));
  const layersById = new Map(style.layers.map(layer => [layer.id, layer]));
  const geometryBatchesByFamilyId = new Map<string, GeometryBatch>();
  let background: BackgroundBatch | undefined;

  for (const entry of renderOrder) {
    const layer = layersById.get(entry.layerId);
    if (!layer || !isLayerVisibleAtZoom(layer, coordinate.level)) {
      continue;
    }

    if (entry.kind === 'background') {
      const backgroundLayer = layer as BackgroundLayerSpecification;
      background = {
        color: typeof backgroundLayer.paint?.['background-color'] === 'string'
          ? backgroundLayer.paint['background-color']
          : undefined,
        layerId: entry.layerId,
        order: entry.order,
      };
      continue;
    }

    if (entry.sourceId !== coordinate.sourceId) {
      continue;
    }

    let geometryBatch = geometryBatchesByFamilyId.get(entry.familyId);
    if (!geometryBatch) {
      const family = familiesById.get(entry.familyId);
      if (!family) {
        throw new Error(`Missing layer family for render entry: ${entry.familyId}`);
      }

      geometryBatch = {
        backend: family.type,
        familyId: family.id,
        layerIds: [],
        order: entry.order,
        sourceId: family.sourceId,
        sourceLayer: family.sourceLayer,
        type: family.type,
      };
      if (family.filter !== undefined) {
        geometryBatch.filter = family.filter;
      }
      geometryBatchesByFamilyId.set(entry.familyId, geometryBatch);
    }

    geometryBatch.layerIds.push(entry.layerId);
  }

  return {
    background,
    epoch: styleEpoch,
    geometryBatches: [...geometryBatchesByFamilyId.values()],
    key: createScopedRenderTileKey(key, styleEpoch),
  };
}

export function parseRenderTileCoordinateFromKey(key: string) {
  const parts = key.split('/');
  if (parts.length < 4) {
    throw new Error(`Invalid render tile key: ${key}`);
  }

  const level = Number(parts[parts.length - 3]);
  if (!Number.isInteger(level)) {
    throw new TypeError(`Invalid render tile key level: ${key}`);
  }

  return {
    level,
    sourceId: parts.slice(0, -3).join('/'),
  };
}
