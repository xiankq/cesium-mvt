import type { Rectangle, TilingScheme } from 'cesium';

export interface TileCoord {
  x: number;
  y: number;
  level: number;
}

export type TileGeometryType = 'Unknown' | 'Point' | 'LineString' | 'Polygon';

export type TileGeometryPart = Array<[number, number]>;
export type TileGeometry = TileGeometryPart[];

export interface MvtSourceOptions {
  id: string;
  urlTemplate: string;
  subdomains?: string | string[];
  minimumLevel?: number;
  maximumLevel?: number;
  rectangle?: Rectangle;
  tilingScheme?: TilingScheme;
  tileWidth?: number;
  tileHeight?: number;
  hasAlphaChannel?: boolean;
  customTags?: Record<string, (context: UrlTemplateContext) => string>;
}

export interface UrlTemplateContext {
  x: number;
  y: number;
  level: number;
  rectangle: Rectangle;
  nativeRectangle: Rectangle;
  tilingScheme: TilingScheme;
  tileWidth: number;
  tileHeight: number;
  subdomains: string[];
  maximumLevel?: number;
  urlSchemeZeroPadding?: Record<string, string>;
  customTags?: Record<string, (context: UrlTemplateContext) => string>;
}

export interface TileDecodeJob {
  id: string;
  sourceId: string;
  coord: TileCoord;
  url: string;
  requestedAt: number;
}

export type TileDecodeEvent
  = | {
    type: 'decoded';
    tile: DecodedTileRecord;
  }
  | {
    type: 'evicted';
    tileId: string;
  };

export interface DecodedFeatureRecord {
  id: number | string | undefined;
  type: TileGeometryType;
  bbox: [number, number, number, number];
  properties: Record<string, number | string | boolean>;
  geometry: TileGeometry;
}

export interface DecodedLayerRecord {
  name: string;
  extent: number;
  featureCount: number;
  geometryHistogram: Record<TileGeometryType, number>;
  features: DecodedFeatureRecord[];
}

export interface DecodedTileRecord {
  id: string;
  sourceId: string;
  coord: TileCoord;
  url: string;
  fetchedBytes: number;
  requestedAt: number;
  fetchedAt: number;
  decodedAt: number;
  layers: DecodedLayerRecord[];
}

export interface MvtSchedulerSnapshot {
  sourceId: string;
  queued: number;
  inFlight: number;
  cached: number;
  requested: number;
  decoded: number;
  failed: number;
  lastTileId?: string;
  lastError?: string;
  maxConcurrent: number;
}

export interface MvtViewportSnapshot {
  sourceId: string;
  rectangle?: Rectangle;
  zoom: number;
  level: number;
  activeTileIds: string[];
  enteredTileIds: string[];
  exitedTileIds: string[];
}

export type MvtViewportListener = (snapshot: MvtViewportSnapshot) => void;

export interface MvtProviderOptions {
  source: MvtSourceOptions;
  maxConcurrentRequests?: number;
  cacheSize?: number;
}

export type CesiumMvtRuntimeOptions = MvtProviderOptions;
