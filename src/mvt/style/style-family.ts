import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { CompiledStyleLayer, StyleFamily, StyleLayerSpecification } from '../types';
import { groupByLayout } from '@maplibre/maplibre-gl-style-spec';
import { createFilterEvaluator } from './filter';

export function buildStyleFamilies(
  styleLayers: readonly StyleLayerSpecification[],
  compiledLayerMap: ReadonlyMap<string, CompiledStyleLayer>,
  sourceId?: string,
): StyleFamily[] {
  const families: StyleFamily[] = [];
  for (const layoutGroup of groupByLayout([...styleLayers] as LayerSpecification[])) {
    const compiledLayers = layoutGroup
      .map(styleLayer => compiledLayerMap.get(styleLayer.id))
      .filter((compiledLayer): compiledLayer is CompiledStyleLayer => Boolean(compiledLayer));
    const firstLayer = compiledLayers[0];
    if (!firstLayer || firstLayer.type === 'background') {
      continue;
    }
    if (sourceId && firstLayer.source !== sourceId) {
      continue;
    }

    families.push({
      key: createStyleFamilyKey(firstLayer),
      filterKey: firstLayer.filterKey,
      layers: compiledLayers,
      layoutKey: firstLayer.layoutKey,
      source: firstLayer.source,
      sourceLayer: firstLayer.sourceLayer,
      type: firstLayer.type,
    });
  }

  return families.sort((left, right) => left.layers[0].order - right.layers[0].order);
}

export function compileStyleLayer(
  styleLayer: StyleLayerSpecification,
  order: number,
): CompiledStyleLayer {
  const layout = cloneStyleProperties(styleLayer.layout);
  const paint = cloneStyleProperties(styleLayer.paint);
  const filterSpecification = 'filter' in styleLayer ? styleLayer.filter : undefined;
  const layoutKey = stableStringify(layout);
  const filterKey = stableStringify(filterSpecification ?? null);
  const source = 'source' in styleLayer ? styleLayer.source : undefined;
  const sourceLayer = 'source-layer' in styleLayer ? styleLayer['source-layer'] : undefined;

  return {
    filterEvaluator: createFilterEvaluator(filterSpecification),
    filterKey,
    filterSpecification,
    id: styleLayer.id,
    layout,
    layoutKey,
    maxzoom: styleLayer.maxzoom,
    minzoom: styleLayer.minzoom,
    order,
    paint,
    source,
    sourceLayer,
    type: styleLayer.type,
    visibility: layout.visibility === 'none' ? 'none' : 'visible',
  };
}

export function createStyleFamilyKey(styleLayer: CompiledStyleLayer): string {
  return [
    styleLayer.source ?? '',
    styleLayer.sourceLayer ?? '',
    styleLayer.type,
    styleLayer.layoutKey,
    styleLayer.filterKey,
  ].join('::');
}

export function stableStringify(input: unknown): string {
  if (input === null) {
    return 'null';
  }
  if (input === undefined) {
    return 'undefined';
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return JSON.stringify(input);
  }
  if (typeof input === 'string') {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map(item => stableStringify(item)).join(',')}]`;
  }
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  throw new Error(`Unsupported value for stable stringify: ${String(input)}`);
}

function cloneStyleProperties(input?: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }

  return { ...(input as Record<string, unknown>) };
}
