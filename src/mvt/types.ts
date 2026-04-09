import type { BoundingRectangle, Scene } from '@cesium/engine';
import type Point from '@mapbox/point-geometry';
import type { VectorTileFeature } from '@mapbox/vector-tile';
import type { Feature, FilterSpecification, LayerSpecification, StyleSpecification as MaplibreStyleSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';

export type RenderableLayerType = Extract<
  LayerSpecification['type'],
  'background' | 'fill' | 'line' | 'circle' | 'symbol'
>;

export type TileState
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

export interface TileCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface FilterFeature {
  id?: Feature['id'];
  geometryType?: Feature['type'];
  properties: Feature['properties'];
}

export type FilterEvaluator = (feature: FilterFeature, zoom?: number) => boolean;

export type StyleFilterSpecification = FilterSpecification;
export type StyleSourceSpecification = VectorSourceSpecification;
export type StyleLayerSpecification = Extract<LayerSpecification, { type: RenderableLayerType }>;
export { type MaplibreStyleSpecification as StyleSpecification };

export interface TileJson {
  maxzoom?: number;
  minzoom?: number;
  tilejson?: string;
  tiles?: string[];
}

export interface StyleSpriteEntry {
  height: number;
  pixelRatio?: number;
  sdf?: boolean;
  width: number;
  x: number;
  y: number;
}

export interface StyleSpriteAtlas {
  entries: ReadonlyMap<string, StyleSpriteEntry>;
  image: HTMLImageElement;
  imageHeight: number;
  imageUrl: string;
  imageWidth: number;
  jsonUrl: string;
}

export type VectorFeatureProperties = VectorTileFeature['properties'];
export type VectorGeometryType = Extract<Feature['type'], 'Point' | 'LineString' | 'Polygon'>;

export interface BucketBaseFeature {
  geometryType: VectorGeometryType;
  id?: VectorTileFeature['id'];
  properties: VectorFeatureProperties;
}

export interface PointBucketFeature extends BucketBaseFeature {
  geometry: Point[][];
  geometryType: 'Point';
}

export interface LineBucketFeature extends BucketBaseFeature {
  geometry: Point[][];
  geometryType: 'LineString';
}

export interface PolygonBucketFeature extends BucketBaseFeature {
  geometry: Point[][][];
  geometryType: 'Polygon';
}

export type BucketFeature
  = | PointBucketFeature
    | LineBucketFeature
    | PolygonBucketFeature;

export interface TileBucket {
  byteLength: number;
  extent: number;
  familyKey: string;
  featureCount: number;
  features: BucketFeature[];
  layerIds: string[];
  sourceLayer: string;
  type: Exclude<RenderableLayerType, 'background'>;
  vertexCount: number;
}

export interface ParsedTileData {
  bucketCount: number;
  buckets: TileBucket[];
  byteLength: number;
  sourceLayers: string[];
}

export interface FeatureIndexBounds {
  maxU: number;
  maxV: number;
  minU: number;
  minV: number;
}

export interface FeatureIndexEntry {
  bounds: FeatureIndexBounds;
  geometryType: VectorGeometryType;
  id?: BucketFeature['id'];
  layerId: string;
  order: number;
  properties: VectorFeatureProperties;
  sourceLayer: string;
}

export interface FeatureIndex {
  entries: readonly FeatureIndexEntry[];
}

export type MeshIndexArray = Uint16Array | Uint32Array;

export interface MeshBucketBase {
  bounds: BoundingRectangle;
  byteLength: number;
  familyKey: string;
  indexCount: number;
  indices: MeshIndexArray;
  layerIds: string[];
  sourceLayer: string;
  vertexCount: number;
}

export interface FillMeshBucket extends MeshBucketBase {
  positions: Float32Array;
  type: 'fill';
}

export interface LineMeshBucket extends MeshBucketBase {
  extrudes: Float32Array;
  positions: Float32Array;
  type: 'line';
}

export interface CircleMeshBucket extends MeshBucketBase {
  centers: Float32Array;
  corners: Int8Array;
  type: 'circle';
}

export type MeshBucket
  = | FillMeshBucket
    | LineMeshBucket
    | CircleMeshBucket;

export interface TileMeshData {
  bucketCount: number;
  buckets: MeshBucket[];
  byteLength: number;
  unsupportedBucketCount: number;
}

export interface CompiledStyleLayer {
  filterEvaluator: FilterEvaluator;
  filterKey: string;
  filterSpecification?: StyleFilterSpecification;
  id: string;
  layout: Record<string, unknown>;
  layoutKey: string;
  maxzoom?: number;
  minzoom?: number;
  order: number;
  paint: Record<string, unknown>;
  source?: string;
  sourceLayer?: string;
  type: RenderableLayerType;
  visibility: 'none' | 'visible';
}

export interface StyleFamily {
  key: string;
  filterKey: string;
  layers: CompiledStyleLayer[];
  layoutKey: string;
  source?: string;
  sourceLayer?: string;
  type: RenderableLayerType;
}

export interface PrimitiveFrameState {
  frameNumber: number;
  scene?: Scene;
}

export interface TilesetPrimitiveStats {
  cpuCacheBytes: number;
  frameNumber: number;
  gpuCacheBytes: number;
  loadingQueueSize: number;
  parseQueueSize: number;
  sourceCacheBytes: number;
  tileCount: number;
  uploadQueueSize: number;
}
