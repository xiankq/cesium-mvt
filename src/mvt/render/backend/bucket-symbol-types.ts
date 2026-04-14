import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { BillboardCollection, LabelCollection } from 'cesium';
import type { ParsedTileResult } from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import type { SymbolLayerStyle } from '../../style/layer-style-resolver';
import type { SymbolCollision } from './symbol-render-utils';

export interface BucketSymbolCollectionHandle {
  byteLength: number;
  collection: LabelCollection | BillboardCollection;
  layerId: string;
  itemCount: number;
}

export interface BucketSymbolPlacementHandle {
  anchorX: number;
  anchorY: number;
  collision?: SymbolCollision;
  key: string;
  layerId: string;
  lineAngle?: number;
  renderables: BucketSymbolRenderableHandle[];
  sourceIndex: number;
  sourceLayer?: string;
  textAnchor?: SymbolLayerStyle['textAnchor'];
  textOffset?: [number, number];
}

export interface BucketSymbolRenderableHandle {
  collection: BillboardCollection | LabelCollection;
  index: number;
}

export interface BucketSymbolTileHandle {
  byteLength: number;
  collections: BucketSymbolCollectionHandle[];
  placements: BucketSymbolPlacementHandle[];
  key: string;
}

export interface CreateBucketSymbolTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  tileWidth?: number;
  style: StyleSpecification;
}
