import type { Billboard, BoundingRectangle, Cartesian2, Cartesian3, Color, HorizontalOrigin, Label, LabelStyle, VerticalOrigin } from '@cesium/engine';
import type { MvtSymbolCollisionIndex } from './mvt-symbol-collision';

export interface MvtTileRenderableLike {
  byteLength: number;
  destroy: () => void;
  update: (frameState: unknown, collisionIndex?: MvtSymbolCollisionIndex) => void;
}

export interface MvtSymbolAnchor {
  angle: number;
  mapScale: number;
  mapX: number;
  mapY: number;
  position: Cartesian3;
}

export interface MvtSymbolIconItem {
  billboard?: Billboard;
  color: Color;
  collisionBox?: MvtSymbolCollisionBox;
  compositeKey?: string;
  compositeLabel?: MvtResolvedSymbolLabel;
  height: number;
  horizontalOrigin: HorizontalOrigin;
  image: string;
  imageSubRegion: BoundingRectangle;
  pixelOffset: Cartesian2;
  position: Cartesian3;
  rotation: number;
  verticalOrigin: VerticalOrigin;
  width: number;
}

export interface MvtSymbolLabelItem {
  fillColor: Color;
  font: string;
  horizontalOrigin: HorizontalOrigin;
  label?: Label;
  outlineColor: Color;
  outlineWidth: number;
  pixelOffset: Cartesian2;
  position: Cartesian3;
  style: LabelStyle;
  text: string;
  verticalOrigin: VerticalOrigin;
}

export interface MvtSymbolLabelGroup {
  collisionBox?: MvtSymbolCollisionBox;
  items: MvtSymbolLabelItem[];
}

export interface MvtSymbolPlacementGroup {
  icon?: MvtSymbolIconItem;
  label?: MvtSymbolLabelGroup;
  layerId: string;
  sortKey?: number;
  text?: string;
  visible?: boolean;
}

export interface MvtResolvedSymbolIcon {
  color: Color;
  height: number;
  horizontalOrigin: HorizontalOrigin;
  image: string;
  imageSubRegion: BoundingRectangle;
  pixelOffset: Cartesian2;
  rotation: number;
  verticalOrigin: VerticalOrigin;
  width: number;
}

export interface MvtResolvedSymbolLabel {
  blockHeight: number;
  blockWidth: number;
  fillColor: Color;
  font: string;
  horizontalOrigin: HorizontalOrigin;
  lineHeight: number;
  lines: string[];
  outlineColor: Color;
  outlineWidth: number;
  pixelOffset: Cartesian2;
  style: LabelStyle;
  verticalOrigin: VerticalOrigin;
}

export interface MvtSymbolCollisionBox {
  height: number;
  horizontalOrigin: HorizontalOrigin;
  latitude: number;
  longitude: number;
  padding: number;
  pixelOffset: Cartesian2;
  position: Cartesian3;
  tileMaxX: number;
  tileMaxY: number;
  tileMinX: number;
  tileMinY: number;
  verticalOrigin: VerticalOrigin;
  width: number;
}
