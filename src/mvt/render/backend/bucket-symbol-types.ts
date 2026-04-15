import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Billboard, BillboardCollection, Label, LabelCollection } from 'cesium';
import type { ParsedTileResult } from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import type { SymbolLayerStyle } from '../../style/layer-style-resolver';
import type { StyleIndex } from '../../style/style-manager';
import type { SymbolCollision } from './symbol-render-utils';

export interface BucketSymbolCollectionHandle {
  byteLength: number;
  collection: LabelCollection | BillboardCollection;
  layerId: string;
  itemCount: number;
}

export type BucketSymbolLabelDescriptor = Parameters<LabelCollection['add']>[0];
export type BucketSymbolBillboardDescriptor = Parameters<BillboardCollection['add']>[0];

export type BucketSymbolRenderableDescriptor
  = | {
    collection: BillboardCollection;
    collectionHandle: BucketSymbolCollectionHandle;
    options: BucketSymbolBillboardDescriptor;
  }
  | {
    collection: LabelCollection;
    collectionHandle: BucketSymbolCollectionHandle;
    options: BucketSymbolLabelDescriptor;
  };

export interface BucketSymbolPlacementHandle {
  anchorX: number;
  anchorY: number;
  key: string;
  layerId: string;
  lineAngle?: number;
  collisionParts: BucketSymbolPlacementPartHandle[];
  renderables: BucketSymbolRenderableHandle[];
  sortKey?: number;
  sortKeyIsConstant?: boolean;
  sortByViewportY?: boolean;
  viewportLatitude?: number;
  sourceIndex: number;
  sourceLayer?: string;
  zOrder: SymbolLayerStyle['zOrder'];
}

export interface BucketSymbolPlacementPartHandle {
  collision?: SymbolCollision;
  groupKey: string;
  kind: 'icon' | 'text';
  renderableDescriptors: BucketSymbolRenderableDescriptor[];
  renderables: BucketSymbolRenderableHandle[];
  textAnchor?: SymbolLayerStyle['textAnchor'];
  textOffset?: [number, number];
}

export interface BucketSymbolRenderableHandle {
  collection: BillboardCollection | LabelCollection;
  item: Billboard | Label;
  index: number;
  visible: boolean;
}

export interface BucketSymbolTileHandle {
  byteLength: number;
  collections: BucketSymbolCollectionHandle[];
  materializationCursor: number;
  placements: BucketSymbolPlacementHandle[];
  visibleSourceIndexesByLayerAndSourceLayer?: Map<string, Map<string, Set<number>>>;
  key: string;
}

export interface CreateBucketSymbolTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  priority?: number;
  styleEpoch?: number;
  tileWidth?: number;
  styleIndex?: StyleIndex;
  style: StyleSpecification;
}
