import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LayerFamily } from './layer-family';
import type { StyleSet } from './style-set';
import { createLayerFamilies } from './layer-family';
import { loadStyleSet } from './style-loader';

export interface StyleManagerOptions {
  style?: string | StyleSpecification;
}

export class StyleManager {
  private styleSet?: StyleSet;
  private layerFamilies: LayerFamily[] = [];
  private styleEpoch = 0;

  async loadStyle(style: string | StyleSpecification): Promise<StyleSet> {
    const styleSet = await loadStyleSet({ style });
    this.updateStyle(styleSet);
    return styleSet;
  }

  updateStyle(styleSet: StyleSet): void {
    this.styleEpoch += 1;
    this.styleSet = styleSet;
    this.layerFamilies = createLayerFamilies(styleSet.style);
  }

  getStyle(): StyleSpecification | undefined {
    return this.styleSet?.style;
  }

  getStyleSet(): StyleSet | undefined {
    return this.styleSet;
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
