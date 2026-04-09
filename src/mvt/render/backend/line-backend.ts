import type {
  LineLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { FeatureBatch, FeatureTile } from '../feature-tile';
import {
  BufferPolyline,
  BufferPolylineCollection,
  BufferPolylineMaterial,
  Color,
  WebMercatorTilingScheme,
} from 'cesium';
import {
  createTileProjectionContext,
  projectTilePoint,
  resolveFeatureId,
} from './tile-projection';

export interface LineCollectionHandle {
  byteLength: number;
  collection: BufferPolylineCollection;
  layerId: string;
  polylineCount: number;
}

export interface LineTileHandle {
  byteLength: number;
  collections: LineCollectionHandle[];
  key: string;
}

export interface CreateLineTileHandleOptions {
  featureTile: FeatureTile;
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

interface ProjectedLine {
  featureId: number;
  positions: Float64Array;
  vertexCount: number;
}

const DEFAULT_LINE_COLOR = Color.BLACK;
const DEFAULT_LINE_WIDTH = 1;

export function createLineTileHandle({
  featureTile,
  level,
  style,
  tilingScheme = new WebMercatorTilingScheme(),
  x,
  y,
}: CreateLineTileHandleOptions): LineTileHandle | undefined {
  const lineBatches = featureTile.geometryBatches.filter(isLineBatch);
  if (lineBatches.length === 0) {
    return undefined;
  }

  const layersById = new Map(
    style.layers
      .filter(isLineLayer)
      .map(layer => [layer.id, layer]),
  );
  const projectionContext = createTileProjectionContext(level, x, y, tilingScheme);
  const collections: LineCollectionHandle[] = [];

  for (const batch of lineBatches) {
    const projectedLines = projectBatchLines(batch, projectionContext);
    if (projectedLines.length === 0) {
      continue;
    }

    const vertexCount = projectedLines.reduce(
      (total, entry) => total + entry.vertexCount,
      0,
    );

    for (const layerId of batch.layerIds) {
      const layer = layersById.get(layerId);
      if (!layer) {
        continue;
      }

      const collection = new BufferPolylineCollection({
        primitiveCountMax: projectedLines.length,
        vertexCountMax: vertexCount,
      });
      const flyweight = new BufferPolyline();
      const material = createLineMaterial(layer);

      for (const projectedLine of projectedLines) {
        collection.add({
          material,
          positions: projectedLine.positions,
        }, flyweight);
        flyweight.featureId = projectedLine.featureId;
      }

      collections.push({
        byteLength: collection.byteLength,
        collection,
        layerId,
        polylineCount: projectedLines.length,
      });
    }
  }

  if (collections.length === 0) {
    return undefined;
  }

  return {
    byteLength: collections.reduce(
      (total, entry) => total + entry.byteLength,
      0,
    ),
    collections,
    key: featureTile.key,
  };
}

function isLineBatch(batch: FeatureTile['geometryBatches'][number]): batch is FeatureBatch {
  return batch.type === 'line';
}

function isLineLayer(
  layer: StyleSpecification['layers'][number],
): layer is LineLayerSpecification {
  return layer.type === 'line';
}

function projectBatchLines(
  batch: FeatureBatch,
  projectionContext: ReturnType<typeof createTileProjectionContext>,
) {
  const result: ProjectedLine[] = [];
  const extent = batch.extent || 4096;
  let fallbackFeatureId = 0;

  for (const feature of batch.features) {
    const featureId = resolveFeatureId(feature.id, fallbackFeatureId);
    fallbackFeatureId += 1;

    for (const part of feature.geometry) {
      if (part.length < 2) {
        continue;
      }

      const positions = new Float64Array(part.length * 3);
      for (let index = 0; index < part.length; index += 1) {
        const projectedPoint = projectTilePoint(part[index], extent, projectionContext);
        positions[index * 3] = projectedPoint.x;
        positions[index * 3 + 1] = projectedPoint.y;
        positions[index * 3 + 2] = projectedPoint.z;
      }

      result.push({
        featureId,
        positions,
        vertexCount: part.length,
      });
    }
  }

  return result;
}

function createLineMaterial(layer: LineLayerSpecification) {
  const paint = layer.paint ?? {};
  const lineColor = applyOpacity(
    resolveColorPaintValue(
      paint['line-color'],
      DEFAULT_LINE_COLOR,
    ),
    resolveNumberPaintValue(paint['line-opacity'], 1),
  );

  return new BufferPolylineMaterial({
    color: lineColor,
    width: clampPixels(
      resolveNumberPaintValue(
        paint['line-width'],
        DEFAULT_LINE_WIDTH,
      ),
    ),
  });
}

function resolveColorPaintValue(value: unknown, fallback: Color) {
  if (typeof value !== 'string') {
    return Color.clone(fallback);
  }

  return Color.fromCssColorString(value) ?? Color.clone(fallback);
}

function resolveNumberPaintValue(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : fallback;
}

function applyOpacity(color: Color, opacity: number) {
  const resolvedColor = Color.clone(color);
  resolvedColor.alpha *= clampOpacity(opacity);
  return resolvedColor;
}

function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clampPixels(value: number) {
  return Math.min(255, Math.max(0, value));
}
