import type {
  CircleLayerSpecification,
  SourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';

export interface AppendPreviewCircleLayerOptions {
  id: string;
  sourceId: string;
  sourceLayer?: string;
}

const INTERNAL_PREVIEW_LAYER_ID = '__cesium-mvt-preview-circle__';
const PREVIEW_SOURCE_LAYER_PRIORITIES = ['place', 'poi'];

export function appendPreviewCircleLayer(
  style: StyleSpecification,
  options: AppendPreviewCircleLayerOptions,
): StyleSpecification {
  const nextStyle = cloneStyle(style);
  const previewLayer = createPreviewCircleLayer(options);

  nextStyle.layers = nextStyle.layers
    .filter(layer => layer.id !== options.id)
    .concat(previewLayer);

  return nextStyle;
}

function createPreviewCircleLayer(
  options: AppendPreviewCircleLayerOptions,
): CircleLayerSpecification {
  return {
    id: options.id,
    paint: {
      'circle-color': '#ff3b30',
      'circle-opacity': 0.9,
      'circle-radius': 4,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
    source: options.sourceId,
    ...(options.sourceLayer
      ? {
          'source-layer': options.sourceLayer,
        }
      : {}),
    type: 'circle',
  };
}

export function ensurePreviewCircleLayer(
  style: StyleSpecification,
): StyleSpecification {
  if (style.layers.some(layer => layer.type === 'circle' || layer.id === INTERNAL_PREVIEW_LAYER_ID)) {
    return style;
  }

  const target = findPreviewTarget(style);
  if (!target) {
    return style;
  }

  return appendPreviewCircleLayer(style, {
    id: INTERNAL_PREVIEW_LAYER_ID,
    sourceId: target.sourceId,
    sourceLayer: target.sourceLayer,
  });
}

function cloneStyle(style: StyleSpecification): StyleSpecification {
  if (typeof structuredClone === 'function') {
    return structuredClone(style);
  }

  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}

function findPreviewTarget(style: StyleSpecification) {
  const candidates = style.layers
    .filter(isSymbolLayer)
    .map(layer => createPreviewTarget(style.sources[layer.source], layer))
    .filter((candidate): candidate is AppendPreviewCircleLayerOptions => Boolean(candidate));

  if (candidates.length === 0) {
    return undefined;
  }

  for (const sourceLayer of PREVIEW_SOURCE_LAYER_PRIORITIES) {
    const candidate = candidates.find(entry => entry.sourceLayer === sourceLayer);
    if (candidate) {
      return candidate;
    }
  }

  return candidates[0];
}

function isSymbolLayer(
  layer: StyleSpecification['layers'][number],
): layer is SymbolLayerSpecification {
  return layer.type === 'symbol' && typeof layer.source === 'string';
}

function createPreviewTarget(
  source: SourceSpecification | undefined,
  layer: SymbolLayerSpecification,
): AppendPreviewCircleLayerOptions | undefined {
  if (!source) {
    return undefined;
  }

  if (source.type === 'vector' && typeof layer['source-layer'] === 'string') {
    return {
      id: '',
      sourceId: layer.source,
      sourceLayer: layer['source-layer'],
    };
  }

  if (source.type === 'geojson') {
    return {
      id: '',
      sourceId: layer.source,
    };
  }

  return undefined;
}
