import type { Billboard, BoundingRectangle, Cartesian2, Cartesian3, Color, HorizontalOrigin, Label, LabelStyle, VerticalOrigin } from '@cesium/engine';
import type { SymbolCollisionIndex } from './symbol-collision';

export interface TileRenderableLike {
  byteLength: number;
  destroy: () => void;
  update: (frameState: unknown, collisionIndex?: SymbolCollisionIndex) => void;
}

export interface SymbolAnchor {
  angle: number;
  mapScale: number;
  mapX: number;
  mapY: number;
  position: Cartesian3;
}

export interface SymbolIconItem {
  billboard?: Billboard;
  color: Color;
  collisionBox?: SymbolCollisionBox;
  compositeKey?: string;
  compositeLabel?: ResolvedSymbolLabel;
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

export interface SymbolLabelItem {
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

export interface SymbolLabelGroup {
  collisionBox?: SymbolCollisionBox;
  items: SymbolLabelItem[];
}

export interface SymbolPlacementGroup {
  icon?: SymbolIconItem;
  label?: SymbolLabelGroup;
  layerId: string;
  sortKey?: number;
  text?: string;
  visible?: boolean;
}

export interface ResolvedSymbolIcon {
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

export interface ResolvedSymbolLabel {
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

export interface SymbolCollisionBox {
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
