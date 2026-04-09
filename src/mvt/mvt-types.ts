import type { BoundingRectangle, Scene } from '@cesium/engine';
import type Point from '@mapbox/point-geometry';
import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { Feature, FilterSpecification, LayerSpecification, StyleSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';

export type MvtRenderableLayerType = Extract<
  LayerSpecification['type'],
  'background' | 'fill' | 'line' | 'circle' | 'symbol'
>;

export type MvtTileState
  = | 'idle'
    | 'loading'
    | 'parse-queued'
    | 'parsing'
    | 'parsed'
    | 'upload-queued'
    | 'uploading'
    | 'ready'
    | 'failed'
    | 'evicted';

export interface MvtTileCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface MvtFilterFeature {
  id?: Feature['id'];
  geometryType?: Feature['type'];
  properties: Feature['properties'];
}

export type MvtFilterEvaluator = (feature: MvtFilterFeature, zoom?: number) => boolean;

export type MvtStyleFilterSpecification = FilterSpecification;
export type MvtStyleSourceSpecification = VectorSourceSpecification;
export type MvtStyleLayerSpecification = Extract<LayerSpecification, { type: MvtRenderableLayerType }>;
export type MvtStyleSpecification = StyleSpecification;

export interface MvtTileJson {
  maxzoom?: number;
  minzoom?: number;
  tilejson?: string;
  tiles?: string[];
}

export interface MvtStyleSpriteEntry {
  height: number;
  pixelRatio?: number;
  sdf?: boolean;
  width: number;
  x: number;
  y: number;
}

export interface MvtStyleSpriteAtlas {
  entries: ReadonlyMap<string, MvtStyleSpriteEntry>;
  image: HTMLImageElement;
  imageHeight: number;
  imageUrl: string;
  imageWidth: number;
  jsonUrl: string;
}

export type MvtVectorFeatureProperties = VectorTileFeature['properties'];
export type MvtVectorGeometryType = Extract<Feature['type'], 'Point' | 'LineString' | 'Polygon'>;

export interface MvtBucketBaseFeature {
  geometryType: MvtVectorGeometryType;
  id?: VectorTileFeature['id'];
  properties: MvtVectorFeatureProperties;
}

export interface MvtPointBucketFeature extends MvtBucketBaseFeature {
  geometry: Point[][];
  geometryType: 'Point';
}

export interface MvtLineBucketFeature extends MvtBucketBaseFeature {
  geometry: Point[][];
  geometryType: 'LineString';
}

export interface MvtPolygonBucketFeature extends MvtBucketBaseFeature {
  geometry: Point[][][];
  geometryType: 'Polygon';
}

export type MvtBucketFeature
  = | MvtPointBucketFeature
    | MvtLineBucketFeature
    | MvtPolygonBucketFeature;

export interface MvtTileBucket {
  byteLength: number;
  extent: number;
  familyKey: string;
  featureCount: number;
  features: MvtBucketFeature[];
  layerIds: string[];
  sourceLayer: string;
  type: Exclude<MvtRenderableLayerType, 'background'>;
  vertexCount: number;
}

export interface MvtParsedTileData {
  bucketCount: number;
  buckets: MvtTileBucket[];
  byteLength: number;
  sourceLayers: string[];
}

export interface MvtFeatureIndexBounds {
  maxU: number;
  maxV: number;
  minU: number;
  minV: number;
}

export interface MvtFeatureIndexEntry {
  bounds: MvtFeatureIndexBounds;
  geometryType: MvtVectorGeometryType;
  id?: MvtBucketFeature['id'];
  layerId: string;
  order: number;
  properties: MvtVectorFeatureProperties;
  sourceLayer: string;
}

export interface MvtFeatureIndex {
  entries: readonly MvtFeatureIndexEntry[];
}

export type MvtMeshIndexArray = Uint16Array | Uint32Array;

export interface MvtMeshBucketBase {
  bounds: BoundingRectangle;
  byteLength: number;
  familyKey: string;
  indexCount: number;
  indices: MvtMeshIndexArray;
  layerIds: string[];
  sourceLayer: string;
  vertexCount: number;
}

export interface MvtFillMeshBucket extends MvtMeshBucketBase {
  positions: Float32Array;
  type: 'fill';
}

export interface MvtLineMeshBucket extends MvtMeshBucketBase {
  extrudes: Float32Array;
  positions: Float32Array;
  type: 'line';
}

export interface MvtCircleMeshBucket extends MvtMeshBucketBase {
  centers: Float32Array;
  corners: Int8Array;
  type: 'circle';
}

export type MvtMeshBucket
  = | MvtFillMeshBucket
    | MvtLineMeshBucket
    | MvtCircleMeshBucket;

export interface MvtTileMeshData {
  bucketCount: number;
  buckets: MvtMeshBucket[];
  byteLength: number;
  unsupportedBucketCount: number;
}

export interface MvtCompiledStyleLayer {
  filterEvaluator: MvtFilterEvaluator;
  filterKey: string;
  filterSpecification?: MvtStyleFilterSpecification;
  id: string;
  layout: Record<string, unknown>;
  layoutKey: string;
  maxzoom?: number;
  minzoom?: number;
  order: number;
  paint: Record<string, unknown>;
  source?: string;
  sourceLayer?: string;
  type: MvtRenderableLayerType;
  visibility: 'none' | 'visible';
}

export interface MvtStyleFamily {
  key: string;
  filterKey: string;
  layers: MvtCompiledStyleLayer[];
  layoutKey: string;
  source?: string;
  sourceLayer?: string;
  type: MvtRenderableLayerType;
}

export interface MvtPrimitiveFrameState {
  frameNumber: number;
  scene?: Scene;
}

export interface MvtTilesetPrimitiveStats {
  cpuCacheBytes: number;
  frameNumber: number;
  gpuCacheBytes: number;
  loadingQueueSize: number;
  parseQueueSize: number;
  sourceCacheBytes: number;
  tileCount: number;
  uploadQueueSize: number;
}
