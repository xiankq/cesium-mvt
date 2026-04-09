import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';

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
