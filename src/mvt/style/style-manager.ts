import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { RenderEntry } from '../render/render-order';
import type { LayerFamily } from './layer-family';
import type { StyleSet } from './style-loader';
import { createRenderOrder } from '../render/render-order';
import { createLayerFamilies } from './layer-family';

export interface StyleIndex {
  familiesById: Map<string, LayerFamily>;
  layerFamilies: LayerFamily[];
  layerOrderById: Map<string, number>;
  layersById: Map<string, StyleSpecification['layers'][number]>;
  renderOrder: RenderEntry[];
}

export function createStyleIndex(
  style: StyleSpecification,
  layerFamilies: LayerFamily[],
): StyleIndex {
  return {
    familiesById: new Map(layerFamilies.map(family => [family.id, family])),
    layerFamilies,
    layerOrderById: new Map(style.layers.map((layer, index) => [layer.id, index])),
    layersById: new Map(style.layers.map(layer => [layer.id, layer])),
    renderOrder: createRenderOrder(style, layerFamilies),
  };
}

export class StyleManager {
  private styleSet?: StyleSet;
  private layerFamilies: LayerFamily[] = [];
  private styleIndex?: StyleIndex;
  private styleEpoch = 0;

  updateStyle(styleSet: StyleSet): void {
    this.styleEpoch += 1;
    this.styleSet = styleSet;
    this.layerFamilies = createLayerFamilies(styleSet.style);
    this.styleIndex = createStyleIndex(styleSet.style, this.layerFamilies);
  }

  getStyle(): StyleSpecification | undefined {
    return this.styleSet?.style;
  }

  getLayerFamilies(): LayerFamily[] {
    return this.layerFamilies;
  }

  getStyleIndex(): StyleIndex | undefined {
    return this.styleIndex;
  }

  getStyleEpoch(): number {
    return this.styleEpoch;
  }

  hasStyle(): boolean {
    return this.styleSet !== undefined;
  }
}
