import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LayerFamily } from './layer-family';
import type { StyleSet } from './style-loader';
import { createLayerFamilies } from './layer-family';

export class StyleManager {
  private styleSet?: StyleSet;
  private layerFamilies: LayerFamily[] = [];
  private styleEpoch = 0;

  updateStyle(styleSet: StyleSet): void {
    this.styleEpoch += 1;
    this.styleSet = styleSet;
    this.layerFamilies = createLayerFamilies(styleSet.style);
  }

  getStyle(): StyleSpecification | undefined {
    return this.styleSet?.style;
  }

  getLayerFamilies(): LayerFamily[] {
    return this.layerFamilies;
  }

  getStyleEpoch(): number {
    return this.styleEpoch;
  }

  hasStyle(): boolean {
    return this.styleSet !== undefined;
  }
}
