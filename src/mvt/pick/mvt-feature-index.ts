import type { TilingScheme } from '@cesium/engine';
import type Point from '@mapbox/point-geometry';
import type { MvtDisplayFeatureCache } from '../mesh/mvt-display-feature';
import type {
  MvtBucketFeature,
  MvtCompiledStyleLayer,
  MvtFeatureIndex,
  MvtFeatureIndexBounds,
  MvtFeatureIndexEntry,
  MvtParsedTileData,
  MvtTileCoordinate,
} from '../mvt-types';
import type { MvtStyleSet } from '../style/mvt-style-set';
import { Cartographic, ImageryLayerFeatureInfo, Rectangle } from '@cesium/engine';
import { getClippedDisplayFeature } from '../mesh/mvt-display-feature';
import { normalizePolylinePoints } from '../mesh/mvt-geometry-normalize';
import { createMvtOverzoomTransform } from '../tile/mvt-overzoom';

const scratchRectangle = new Rectangle();

export interface CreateMvtFeatureIndexOptions {
  coordinate: MvtTileCoordinate;
  displayFeatureCache?: MvtDisplayFeatureCache;
  parsedTileData: MvtParsedTileData;
  sourceCoordinate?: MvtTileCoordinate;
  styleSet: MvtStyleSet;
}

export interface PickMvtFeatureIndexOptions {
  coordinate: MvtTileCoordinate;
  featureIndex: MvtFeatureIndex;
  imageryLayer?: unknown;
  latitude: number;
  longitude: number;
  tileHeight: number;
  tileWidth: number;
  tilingScheme: TilingScheme;
}

export function createMvtFeatureIndex(options: CreateMvtFeatureIndexOptions): MvtFeatureIndex {
  const zoom = options.coordinate.z;
  const sourceCoordinate = options.sourceCoordinate ?? options.coordinate;
  const displayTransform = createMvtOverzoomTransform(options.coordinate, sourceCoordinate);
  const entries: MvtFeatureIndexEntry[] = [];

  for (const bucket of options.parsedTileData.buckets) {
    for (const layerId of bucket.layerIds) {
      const layer = options.styleSet.getCompiledLayer(layerId);
      if (!layer || !options.styleSet.isLayerVisibleAtZoom(layer, zoom)) {
        continue;
      }

      for (const feature of bucket.features) {
        const bounds = computeFeatureBounds(
          feature,
          bucket.extent,
          options.displayFeatureCache,
          displayTransform,
          layer,
        );
        if (!bounds) {
          continue;
        }

        entries.push({
          bounds,
          geometryType: feature.geometryType,
          id: feature.id,
          layerId: layer.id,
          order: layer.order,
          properties: feature.properties,
          sourceLayer: bucket.sourceLayer,
        });
      }
    }
  }

  entries.sort((left, right) => right.order - left.order);
  return { entries };
}

export function pickMvtFeatureIndex(options: PickMvtFeatureIndexOptions): ImageryLayerFeatureInfo[] {
  const rectangle = options.tilingScheme.tileXYToRectangle(
    options.coordinate.x,
    options.coordinate.y,
    options.coordinate.z,
    scratchRectangle,
  );
  const width = rectangle.east - rectangle.west;
  const height = rectangle.north - rectangle.south;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const u = (options.longitude - rectangle.west) / width;
  const v = (rectangle.north - options.latitude) / height;
  const toleranceU = 6 / Math.max(1, options.tileWidth);
  const toleranceV = 6 / Math.max(1, options.tileHeight);
  const featureInfos: ImageryLayerFeatureInfo[] = [];
  const seenFeatureKeys = new Set<string>();

  for (const entry of options.featureIndex.entries) {
    if (
      u < entry.bounds.minU - toleranceU
      || u > entry.bounds.maxU + toleranceU
      || v < entry.bounds.minV - toleranceV
      || v > entry.bounds.maxV + toleranceV
    ) {
      continue;
    }

    const featureKey = [
      entry.layerId,
      entry.sourceLayer,
      entry.id ?? '',
      entry.geometryType,
      entry.properties.name ?? entry.properties.name_en ?? '',
    ].join('::');
    if (seenFeatureKeys.has(featureKey)) {
      continue;
    }

    const featureInfo = new ImageryLayerFeatureInfo();
    featureInfo.data = {
      geometryType: entry.geometryType,
      id: entry.id,
      layerId: entry.layerId,
      properties: entry.properties,
      sourceLayer: entry.sourceLayer,
    };
    featureInfo.imageryLayer = options.imageryLayer;
    featureInfo.position = Cartographic.fromRadians(options.longitude, options.latitude);
    featureInfo.configureNameFromProperties(entry.properties);
    featureInfo.configureDescriptionFromProperties({
      ...entry.properties,
      __geometryType: entry.geometryType,
      __layerId: entry.layerId,
      __sourceLayer: entry.sourceLayer,
    });
    featureInfos.push(featureInfo);
    seenFeatureKeys.add(featureKey);
  }

  return featureInfos;
}

function computeFeatureBounds(
  feature: MvtBucketFeature,
  extent: number,
  displayFeatureCache: MvtDisplayFeatureCache | undefined,
  displayTransform: ReturnType<typeof createMvtOverzoomTransform>,
  layer: MvtCompiledStyleLayer,
): MvtFeatureIndexBounds | undefined {
  const displayFeature = getClippedDisplayFeature(feature, extent, displayTransform, displayFeatureCache);
  if (!displayFeature) {
    return undefined;
  }

  const bounds = createEmptyBounds();

  switch (displayFeature.geometryType) {
    case 'Point':
      for (const part of displayFeature.geometry) {
        for (const point of part) {
          includePoint(bounds, point, extent);
        }
      }
      return finalizeBounds(
        bounds,
        resolvePointTolerance(layer, displayTransform.displayCoordinate, displayTransform.sourceCoordinate),
      );
    case 'LineString':
      for (const part of displayFeature.geometry) {
        for (const point of normalizePolylinePoints(part)) {
          includePoint(bounds, point, extent);
        }
      }
      return finalizeBounds(
        bounds,
        resolveLineTolerance(layer, displayTransform.displayCoordinate, displayTransform.sourceCoordinate),
      );
    case 'Polygon':
      for (const polygon of displayFeature.geometry) {
        for (const point of polygon[0] ?? []) {
          includePoint(bounds, point, extent);
        }
      }
      return finalizeBounds(bounds, 0);
  }
}

function createEmptyBounds(): MvtFeatureIndexBounds {
  return {
    maxU: Number.NEGATIVE_INFINITY,
    maxV: Number.NEGATIVE_INFINITY,
    minU: Number.POSITIVE_INFINITY,
    minV: Number.POSITIVE_INFINITY,
  };
}

function finalizeBounds(bounds: MvtFeatureIndexBounds, tolerance: number): MvtFeatureIndexBounds | undefined {
  if (
    !Number.isFinite(bounds.minU)
    || !Number.isFinite(bounds.minV)
    || !Number.isFinite(bounds.maxU)
    || !Number.isFinite(bounds.maxV)
  ) {
    return undefined;
  }

  return {
    maxU: bounds.maxU + tolerance,
    maxV: bounds.maxV + tolerance,
    minU: bounds.minU - tolerance,
    minV: bounds.minV - tolerance,
  };
}

function includePoint(
  bounds: MvtFeatureIndexBounds,
  point: Pick<Point, 'x' | 'y'>,
  extent: number,
): void {
  const u = point.x / extent;
  const v = point.y / extent;
  bounds.minU = Math.min(bounds.minU, u);
  bounds.minV = Math.min(bounds.minV, v);
  bounds.maxU = Math.max(bounds.maxU, u);
  bounds.maxV = Math.max(bounds.maxV, v);
}

function resolveLineTolerance(
  layer: MvtCompiledStyleLayer,
  displayCoordinate: MvtTileCoordinate,
  sourceCoordinate: MvtTileCoordinate,
): number {
  const zoomDelta = Math.max(0, displayCoordinate.z - sourceCoordinate.z);
  const coordinateScale = 2 ** zoomDelta;
  const lineWidth = typeof layer.paint['line-width'] === 'number' ? layer.paint['line-width'] : 4;
  return (Math.max(2, lineWidth) / 512) * (1 / coordinateScale);
}

function resolvePointTolerance(
  layer: MvtCompiledStyleLayer,
  displayCoordinate: MvtTileCoordinate,
  sourceCoordinate: MvtTileCoordinate,
): number {
  const zoomDelta = Math.max(0, displayCoordinate.z - sourceCoordinate.z);
  const coordinateScale = 2 ** zoomDelta;
  if (layer.type === 'circle') {
    const circleRadius = typeof layer.paint['circle-radius'] === 'number' ? layer.paint['circle-radius'] : 6;
    return (Math.max(4, circleRadius * 2) / 512) * (1 / coordinateScale);
  }

  const textSize = typeof layer.layout['text-size'] === 'number' ? layer.layout['text-size'] : 18;
  return (Math.max(6, textSize) / 512) * (1 / coordinateScale);
}
