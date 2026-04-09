import type Point from '@mapbox/point-geometry';
import type {
  CircleLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {
  WebMercatorProjection,
} from 'cesium';
import type { FeatureBatch, FeatureTile } from '../feature-tile';
import {
  BufferPoint,
  BufferPointCollection,
  BufferPointMaterial,
  Cartesian3,
  Color,
  WebMercatorTilingScheme,
} from 'cesium';

// circle 是第一条接入 Cesium 实验性 buffer primitive 的几何后端。
// 输出仍然保留图层顺序，并按图层拆开各自的 paint 结果。
export interface CircleCollectionHandle {
  byteLength: number;
  collection: BufferPointCollection;
  layerId: string;
  pointCount: number;
}

export interface CircleTileHandle {
  byteLength: number;
  collections: CircleCollectionHandle[];
  key: string;
}

export interface CreateCircleTileHandleOptions {
  featureTile: FeatureTile;
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

interface ProjectedPoint {
  featureId: number;
  position: Cartesian3;
}

const DEFAULT_CIRCLE_COLOR = Color.BLACK;
const DEFAULT_CIRCLE_RADIUS = 5;
const DEFAULT_OUTLINE_COLOR = Color.BLACK;
const DEFAULT_OUTLINE_WIDTH = 0;

export function createCircleTileHandle({
  featureTile,
  level,
  style,
  tilingScheme = new WebMercatorTilingScheme(),
  x,
  y,
}: CreateCircleTileHandleOptions): CircleTileHandle | undefined {
  const circleBatches = featureTile.geometryBatches.filter(isCircleBatch);
  if (circleBatches.length === 0) {
    return undefined;
  }

  const layersById = new Map(
    style.layers
      .filter(isCircleLayer)
      .map(layer => [layer.id, layer]),
  );
  const projection = tilingScheme.projection as WebMercatorProjection;
  const tileRectangle = tilingScheme.tileXYToNativeRectangle(x, y, level);
  const collections: CircleCollectionHandle[] = [];

  for (const batch of circleBatches) {
    const projectedPoints = projectBatchPoints(batch, projection, tileRectangle);
    if (projectedPoints.length === 0) {
      continue;
    }

    for (const layerId of batch.layerIds) {
      // 每个图层各自生成一个 collection，便于保留 paint 差异和样式顺序。
      const layer = layersById.get(layerId);
      if (!layer) {
        continue;
      }

      const collection = new BufferPointCollection({
        primitiveCountMax: projectedPoints.length,
      });
      const flyweight = new BufferPoint();
      const material = createCircleMaterial(layer);

      for (const projectedPoint of projectedPoints) {
        collection.add({
          material,
          position: projectedPoint.position,
        }, flyweight);
        flyweight.featureId = projectedPoint.featureId;
      }

      collections.push({
        byteLength: collection.byteLength,
        collection,
        layerId,
        pointCount: projectedPoints.length,
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

function isCircleBatch(batch: FeatureTile['geometryBatches'][number]): batch is FeatureBatch {
  return batch.type === 'circle';
}

function isCircleLayer(
  layer: StyleSpecification['layers'][number],
): layer is CircleLayerSpecification {
  return layer.type === 'circle';
}

function projectBatchPoints(
  batch: FeatureBatch,
  projection: WebMercatorProjection,
  tileRectangle: ReturnType<WebMercatorTilingScheme['tileXYToNativeRectangle']>,
) {
  const result: ProjectedPoint[] = [];
  const extent = batch.extent || 4096;
  let fallbackFeatureId = 0;

  for (const feature of batch.features) {
    const featureId = typeof feature.id === 'number'
      ? feature.id
      : fallbackFeatureId;
    fallbackFeatureId += 1;

    for (const part of feature.geometry) {
      for (const point of part) {
        result.push({
          featureId,
          position: projectPoint(point, extent, projection, tileRectangle),
        });
      }
    }
  }

  return result;
}

function projectPoint(
  point: Point,
  extent: number,
  projection: WebMercatorProjection,
  tileRectangle: ReturnType<WebMercatorTilingScheme['tileXYToNativeRectangle']>,
) {
  const nativeWidth = tileRectangle.east - tileRectangle.west;
  const nativeHeight = tileRectangle.north - tileRectangle.south;
  const nativeX = tileRectangle.west + (point.x / extent) * nativeWidth;
  // 向量瓦片坐标以左上角为原点，y 轴向下增长。
  const nativeY = tileRectangle.north - (point.y / extent) * nativeHeight;
  const cartographic = projection.unproject(new Cartesian3(nativeX, nativeY, 0));
  return Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    0,
  );
}

function createCircleMaterial(layer: CircleLayerSpecification) {
  const paint = layer.paint ?? {};
  const circleColor = applyOpacity(
    resolveColorPaintValue(
      paint['circle-color'],
      DEFAULT_CIRCLE_COLOR,
    ),
    resolveNumberPaintValue(paint['circle-opacity'], 1),
  );
  const outlineColor = applyOpacity(
    resolveColorPaintValue(
      paint['circle-stroke-color'],
      DEFAULT_OUTLINE_COLOR,
    ),
    resolveNumberPaintValue(paint['circle-stroke-opacity'], 1),
  );

  return new BufferPointMaterial({
    color: circleColor,
    outlineColor,
    outlineWidth: clampPointPixels(
      resolveNumberPaintValue(
        paint['circle-stroke-width'],
        DEFAULT_OUTLINE_WIDTH,
      ),
    ),
    // circle-radius 表示半径，而 BufferPoint 的 size 语义是完整点精灵尺寸。
    size: clampPointPixels(
      resolveNumberPaintValue(
        paint['circle-radius'],
        DEFAULT_CIRCLE_RADIUS,
      ) * 2,
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

function clampPointPixels(value: number) {
  return Math.min(255, Math.max(0, value));
}
