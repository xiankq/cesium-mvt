import type { GeoJSONVTTile } from '@maplibre/geojson-vt';
import type { VectorTileFeatureLike, VectorTileLayerLike, VectorTileLike } from '@maplibre/vt-pbf';
import Point from '@mapbox/point-geometry';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt, fromVectorTileJs } from '@maplibre/vt-pbf';

type MvtLocalPoint = [number, number];

type MvtLocalGeometry
  = | { coordinates: MvtLocalPoint | MvtLocalPoint[]; type: 'Point' }
    | { coordinates: MvtLocalPoint[]; type: 'LineString' }
    | { coordinates: MvtLocalPoint[][]; type: 'Polygon' };

export interface MvtLocalFeature {
  geometry: MvtLocalGeometry;
  id?: number;
  properties: Record<string, string | number | boolean>;
}

export interface MvtLocalLayer {
  extent?: number;
  features: MvtLocalFeature[];
}

export function createTestMvtArrayBuffer(
  layerFeatures: Record<string, GeoJSON.FeatureCollection>,
): ArrayBuffer {
  const layerTiles: Record<string, GeoJSONVTTile> = {};

  for (const [layerName, featureCollection] of Object.entries(layerFeatures)) {
    const tileIndex = new GeoJSONVT(featureCollection, {
      buffer: 64,
      extent: 4096,
      indexMaxZoom: 0,
      maxZoom: 0,
      tolerance: 0,
    });
    const tile = tileIndex.getTile(0, 0, 0);
    if (!tile) {
      throw new Error(`Failed to build test tile for layer "${layerName}".`);
    }

    layerTiles[layerName] = tile;
  }

  const encodedTile = fromGeojsonVt(layerTiles, {
    extent: 4096,
    version: 2,
  });

  return encodedTile.buffer.slice(
    encodedTile.byteOffset,
    encodedTile.byteOffset + encodedTile.byteLength,
  );
}

export function createTestLocalMvtArrayBuffer(
  layers: Record<string, MvtLocalLayer>,
  extent = 4096,
): ArrayBuffer {
  const vectorTile = createVectorTileLike(layers, extent);
  const encodedTile = fromVectorTileJs(vectorTile);

  return encodedTile.buffer.slice(
    encodedTile.byteOffset,
    encodedTile.byteOffset + encodedTile.byteLength,
  );
}

function createVectorTileLike(
  layers: Record<string, MvtLocalLayer>,
  defaultExtent: number,
): VectorTileLike {
  return {
    layers: Object.fromEntries(
      Object.entries(layers).map(([layerName, layer]) => {
        return [layerName, createVectorTileLayerLike(layerName, layer, defaultExtent)];
      }),
    ),
  };
}

function createVectorTileLayerLike(
  layerName: string,
  layer: MvtLocalLayer,
  defaultExtent: number,
): VectorTileLayerLike {
  const extent = layer.extent ?? defaultExtent;
  const features = layer.features.map(feature => createVectorTileFeatureLike(feature, extent));

  return {
    extent,
    feature: index => features[index]!,
    length: features.length,
    name: layerName,
    version: 2,
  };
}

function createVectorTileFeatureLike(
  feature: MvtLocalFeature,
  extent: number,
): VectorTileFeatureLike {
  return {
    extent,
    id: feature.id,
    loadGeometry: () => createVectorTileGeometry(feature.geometry),
    properties: feature.properties,
    type: resolveVectorTileFeatureType(feature.geometry.type),
  };
}

function createVectorTileGeometry(geometry: MvtLocalGeometry): Point[][] {
  switch (geometry.type) {
    case 'Point':
      return [normalizePointCoordinates(geometry.coordinates).map(createPoint)];
    case 'LineString':
      return [geometry.coordinates.map(createPoint)];
    case 'Polygon':
      return geometry.coordinates.map(ring => ring.map(createPoint));
  }
}

function normalizePointCoordinates(coordinates: MvtLocalPoint | MvtLocalPoint[]): MvtLocalPoint[] {
  return Array.isArray(coordinates[0]) ? coordinates as MvtLocalPoint[] : [coordinates as MvtLocalPoint];
}

function createPoint(coordinates: MvtLocalPoint): Point {
  return new Point(coordinates[0], coordinates[1]);
}

function resolveVectorTileFeatureType(geometryType: MvtLocalGeometry['type']): 1 | 2 | 3 {
  switch (geometryType) {
    case 'Point':
      return 1;
    case 'LineString':
      return 2;
    case 'Polygon':
      return 3;
  }
}
