import type {
  FillLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { FeatureBatch, FeatureTile } from '../feature-tile';
import { classifyRings } from '@mapbox/vector-tile';
import {
  BufferPolygon,
  BufferPolygonCollection,
  BufferPolygonMaterial,
  Color,
  WebMercatorTilingScheme,
} from 'cesium';
import earcut from 'earcut';
import {
  createTileProjectionContext,
  projectTilePoint,
  resolveFeatureId,
} from './tile-projection';

export interface FillCollectionHandle {
  byteLength: number;
  collection: BufferPolygonCollection;
  layerId: string;
  polygonCount: number;
}

export interface FillTileHandle {
  byteLength: number;
  collections: FillCollectionHandle[];
  key: string;
}

export interface CreateFillTileHandleOptions {
  featureTile: FeatureTile;
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

interface ProjectedPolygon {
  featureId: number;
  holeCount: number;
  positions: Float64Array;
  triangleCount: number;
  triangles: Uint32Array;
  vertexCount: number;
  holes: Uint32Array;
}

const DEFAULT_FILL_COLOR = Color.BLACK;

export function createFillTileHandle({
  featureTile,
  level,
  style,
  tilingScheme = new WebMercatorTilingScheme(),
  x,
  y,
}: CreateFillTileHandleOptions): FillTileHandle | undefined {
  const fillBatches = featureTile.geometryBatches.filter(isFillBatch);
  if (fillBatches.length === 0) {
    return undefined;
  }

  const layersById = new Map(
    style.layers
      .filter(isFillLayer)
      .map(layer => [layer.id, layer]),
  );
  const projectionContext = createTileProjectionContext(level, x, y, tilingScheme);
  const collections: FillCollectionHandle[] = [];

  for (const batch of fillBatches) {
    const projectedPolygons = projectBatchPolygons(batch, projectionContext);
    if (projectedPolygons.length === 0) {
      continue;
    }

    const vertexCount = projectedPolygons.reduce(
      (total, entry) => total + entry.vertexCount,
      0,
    );
    const holeCount = projectedPolygons.reduce(
      (total, entry) => total + entry.holeCount,
      0,
    );
    const triangleCount = projectedPolygons.reduce(
      (total, entry) => total + entry.triangleCount,
      0,
    );

    for (const layerId of batch.layerIds) {
      const layer = layersById.get(layerId);
      if (!layer) {
        continue;
      }

      const collection = new BufferPolygonCollection({
        holeCountMax: holeCount,
        primitiveCountMax: projectedPolygons.length,
        triangleCountMax: triangleCount,
        vertexCountMax: vertexCount,
      });
      const flyweight = new BufferPolygon();
      const material = createFillMaterial(layer);

      for (const projectedPolygon of projectedPolygons) {
        collection.add({
          holes: projectedPolygon.holes,
          material,
          positions: projectedPolygon.positions,
          triangles: projectedPolygon.triangles,
        }, flyweight);
        flyweight.featureId = projectedPolygon.featureId;
      }

      collections.push({
        byteLength: collection.byteLength,
        collection,
        layerId,
        polygonCount: projectedPolygons.length,
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

function isFillBatch(batch: FeatureTile['geometryBatches'][number]): batch is FeatureBatch {
  return batch.type === 'fill';
}

function isFillLayer(
  layer: StyleSpecification['layers'][number],
): layer is FillLayerSpecification {
  return layer.type === 'fill';
}

function projectBatchPolygons(
  batch: FeatureBatch,
  projectionContext: ReturnType<typeof createTileProjectionContext>,
) {
  const result: ProjectedPolygon[] = [];
  const extent = batch.extent || 4096;
  let fallbackFeatureId = 0;

  for (const feature of batch.features) {
    const featureId = resolveFeatureId(feature.id, fallbackFeatureId);
    fallbackFeatureId += 1;

    for (const polygonRings of classifyRings(feature.geometry)) {
      const projectedPolygon = projectPolygonRings(
        polygonRings,
        extent,
        featureId,
        projectionContext,
      );
      if (projectedPolygon) {
        result.push(projectedPolygon);
      }
    }
  }

  return result;
}

function projectPolygonRings(
  rings: ReturnType<typeof classifyRings>[number],
  extent: number,
  featureId: number,
  projectionContext: ReturnType<typeof createTileProjectionContext>,
) {
  const normalizedRings = rings
    .map(normalizeRing)
    .filter(ring => ring.length >= 3);
  if (normalizedRings.length === 0) {
    return undefined;
  }

  const positions: number[] = [];
  const triangulationPositions: number[] = [];
  const holes: number[] = [];
  let vertexCount = 0;

  for (let ringIndex = 0; ringIndex < normalizedRings.length; ringIndex += 1) {
    const ring = normalizedRings[ringIndex];
    if (ringIndex > 0) {
      holes.push(vertexCount);
    }

    for (const point of ring) {
      const projectedPoint = projectTilePoint(point, extent, projectionContext);
      positions.push(projectedPoint.x, projectedPoint.y, projectedPoint.z);
      triangulationPositions.push(point.x, point.y);
      vertexCount += 1;
    }
  }

  const triangulation = earcut(triangulationPositions, holes, 2);
  if (triangulation.length === 0) {
    return undefined;
  }

  return {
    featureId,
    holeCount: holes.length,
    holes: new Uint32Array(holes),
    positions: new Float64Array(positions),
    triangleCount: triangulation.length / 3,
    triangles: new Uint32Array(triangulation),
    vertexCount,
  } satisfies ProjectedPolygon;
}

function normalizeRing(ring: ReturnType<typeof classifyRings>[number][number]) {
  if (ring.length < 2) {
    return ring;
  }

  const firstPoint = ring[0];
  const lastPoint = ring[ring.length - 1];
  if (firstPoint.x !== lastPoint.x || firstPoint.y !== lastPoint.y) {
    return ring;
  }

  return ring.slice(0, -1);
}

function createFillMaterial(layer: FillLayerSpecification) {
  const paint = layer.paint ?? {};
  const fillOpacity = resolveNumberPaintValue(paint['fill-opacity'], 1);
  const hasOutlineColor = typeof paint['fill-outline-color'] === 'string';

  return new BufferPolygonMaterial({
    color: applyOpacity(
      resolveColorPaintValue(
        paint['fill-color'],
        DEFAULT_FILL_COLOR,
      ),
      fillOpacity,
    ),
    outlineColor: applyOpacity(
      resolveColorPaintValue(
        paint['fill-outline-color'],
        DEFAULT_FILL_COLOR,
      ),
      fillOpacity,
    ),
    outlineWidth: hasOutlineColor ? 1 : 0,
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
