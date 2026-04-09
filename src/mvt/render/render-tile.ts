import type {
  BackgroundLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LayerFamily, SupportedGeometryLayerType } from '../style/layer-family';
import type { RenderEntry } from './render-order';

export interface BackgroundBatch {
  color?: string;
  layerId: string;
  order: number;
}

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

export function compileRenderTile({
  key,
  layerFamilies,
  renderOrder,
  style,
  styleEpoch,
}: CompileRenderTileOptions): RenderTile {
  const sourceId = parseSourceIdFromRenderTileKey(key);
  const familiesById = new Map(layerFamilies.map(family => [family.id, family]));
  const backgroundLayersById = new Map(
    style.layers
      .filter(isBackgroundLayer)
      .map(layer => [layer.id, layer]),
  );
  const geometryBatches: GeometryBatch[] = [];
  const seenFamilyIds = new Set<string>();
  let background: BackgroundBatch | undefined;

  for (const entry of renderOrder) {
    if (entry.kind === 'background') {
      const layer = backgroundLayersById.get(entry.layerId);
      background = {
        color: typeof layer?.paint?.['background-color'] === 'string'
          ? layer.paint['background-color']
          : undefined,
        layerId: entry.layerId,
        order: entry.order,
      };
      continue;
    }

    if (entry.sourceId !== sourceId || seenFamilyIds.has(entry.familyId)) {
      continue;
    }

    const family = familiesById.get(entry.familyId);
    if (!family) {
      throw new Error(`Missing layer family for render entry: ${entry.familyId}`);
    }

    geometryBatches.push({
      backend: family.type,
      familyId: family.id,
      layerIds: [...family.layerIds],
      order: entry.order,
      sourceId: family.sourceId,
      sourceLayer: family.sourceLayer,
      type: family.type,
    });
    seenFamilyIds.add(family.id);
  }

  return {
    background,
    epoch: styleEpoch,
    geometryBatches,
    key: `${key}@${styleEpoch}`,
  };
}

function isBackgroundLayer(
  layer: StyleSpecification['layers'][number],
): layer is BackgroundLayerSpecification {
  return layer.type === 'background';
}

function parseSourceIdFromRenderTileKey(key: string) {
  const parts = key.split('/');
  if (parts.length < 4) {
    throw new Error(`Invalid render tile key: ${key}`);
  }

  return parts.slice(0, -3).join('/');
}
