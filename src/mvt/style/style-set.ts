import type {
  BackgroundLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';

export interface StyleSet {
  backgroundColor?: string;
  style: StyleSpecification;
  styleUrl?: string;
}

export function createStyleSet(
  style: StyleSpecification,
  styleUrl?: string,
): StyleSet {
  return {
    backgroundColor: extractBackgroundColor(style),
    style,
    styleUrl,
  };
}

function extractBackgroundColor(style: StyleSpecification) {
  for (const layer of style.layers) {
    if (layer.type !== 'background') {
      continue;
    }

    const backgroundLayer = layer as BackgroundLayerSpecification;
    const backgroundColor = backgroundLayer.paint?.['background-color'];
    if (typeof backgroundColor === 'string') {
      return backgroundColor;
    }
  }

  return undefined;
}
