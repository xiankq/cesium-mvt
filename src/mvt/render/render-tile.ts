import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LayerFamily, SupportedGeometryLayerType } from '../style/layer-family';
import type { StyleIndex } from '../style/style-manager';
import type { RenderEntry } from './render-order';
import { createTileKey } from '../source/tile-request';
import { isLayerVisibleAtZoom } from '../style/layer-family';

const STYLE_EPOCH_PREFIX = /^\d+:/;
const STYLE_EPOCH_SUFFIX = /@\d+$/;

// RenderTile 表示某个 source tile 在当前 styleEpoch 下的渲染计划，
// 此时还没有真正构建出可提交给 Cesium 的几何资源。
export interface GeometryBatch {
  backend: SupportedGeometryLayerType;
  familyId: string;
  layerIds: string[];
  order: number;
  sourceId: string;
  sourceLayer?: string;
  type: SupportedGeometryLayerType;
}

export interface RenderTile {
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
  styleIndex?: StyleIndex;
}

export { createTileKey as createRenderTileKey };

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
  styleIndex,
}: CompileRenderTileOptions): RenderTile {
  const coordinate = parseRenderTileCoordinateFromKey(key);
  const familiesById = styleIndex?.familiesById ?? new Map(layerFamilies.map(family => [family.id, family]));
  const layersById = styleIndex?.layersById ?? new Map(style.layers.map(layer => [layer.id, layer]));
  const geometryBatchesByFamilyId = new Map<string, GeometryBatch>();

  for (const entry of renderOrder) {
    const layer = layersById.get(entry.layerId);
    if (!layer || !isLayerVisibleAtZoom(layer, coordinate.level)) {
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
      geometryBatchesByFamilyId.set(entry.familyId, geometryBatch);
    }

    geometryBatch.layerIds.push(entry.layerId);
  }

  return {
    epoch: styleEpoch,
    geometryBatches: [...geometryBatchesByFamilyId.values()],
    key: createScopedRenderTileKey(key, styleEpoch),
  };
}

export function parseRenderTileCoordinateFromKey(key: string) {
  const scopedKey = stripRenderTileScope(key);
  const lastSlash = scopedKey.lastIndexOf('/');
  const secondLastSlash = scopedKey.lastIndexOf('/', lastSlash - 1);
  const thirdLastSlash = scopedKey.lastIndexOf('/', secondLastSlash - 1);
  if (lastSlash === -1 || secondLastSlash === -1 || thirdLastSlash === -1) {
    throw new Error(`Invalid render tile key: ${key}`);
  }

  const level = Number(scopedKey.slice(thirdLastSlash + 1, secondLastSlash));
  if (!Number.isInteger(level)) {
    throw new TypeError(`Invalid render tile key level: ${key}`);
  }

  const x = Number(scopedKey.slice(secondLastSlash + 1, lastSlash));
  if (!Number.isInteger(x)) {
    throw new TypeError(`Invalid render tile key x: ${key}`);
  }

  const y = Number(scopedKey.slice(lastSlash + 1));
  if (!Number.isInteger(y)) {
    throw new TypeError(`Invalid render tile key y: ${key}`);
  }

  return {
    level,
    x,
    y,
    sourceId: scopedKey.slice(0, thirdLastSlash),
  };
}

// 协调器会把 styleEpoch 编进前缀，编译后的 bucket 也会把 epoch 编进后缀。
// 先把这两种作用域信息去掉，再按 sourceId/z/x/y 解析坐标，避免同一套 key 在不同阶段格式不一致。
export function stripRenderTileScope(key: string): string {
  const scopedKey = STYLE_EPOCH_PREFIX.test(key)
    ? key.slice(key.indexOf(':') + 1)
    : key;

  return scopedKey.replace(STYLE_EPOCH_SUFFIX, '');
}
