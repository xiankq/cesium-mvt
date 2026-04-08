import type { Scene, TilingScheme } from 'cesium';
import type { CompiledStyleLayer } from '../style/renderer';
import type { DecodedFeatureRecord, TileCoord, TileGeometryPart } from '../types';
import { classifyRings } from '@maplibre/maplibre-gl-style-spec';
import { Cartesian3, Cartographic, Color, Material } from 'cesium';

const scratchNativePosition = new Cartesian3();
const scratchCartographic = new Cartographic();

interface PolygonRingGroup {
  outer: TileGeometryPart;
  holes: TileGeometryPart[];
}

export interface TileTransformContext {
  tilingScheme: TilingScheme;
  tile: TileCoord;
  extent: number;
  west: number;
  north: number;
  scaleX: number;
  scaleY: number;
}

export function createTileTransformContext(
  tilingScheme: TilingScheme,
  tile: TileCoord,
  extent: number,
): TileTransformContext {
  const nativeRectangle = tilingScheme.tileXYToNativeRectangle(
    tile.x,
    tile.y,
    tile.level,
  );
  const normalizedExtent = Math.max(1, extent);

  return {
    tilingScheme,
    tile,
    extent: normalizedExtent,
    west: nativeRectangle.west,
    north: nativeRectangle.north,
    scaleX: (nativeRectangle.east - nativeRectangle.west) / normalizedExtent,
    scaleY: (nativeRectangle.north - nativeRectangle.south) / normalizedExtent,
  };
}

export function tilePointToCartesianWithContext(
  context: TileTransformContext,
  point: [number, number],
): Cartesian3 {
  const xRatio = point[0];
  const yRatio = point[1];

  scratchNativePosition.x = context.west + xRatio * context.scaleX;
  scratchNativePosition.y = context.north - yRatio * context.scaleY;
  scratchNativePosition.z = 0;

  const cartographic = context.tilingScheme.projection.unproject(
    scratchNativePosition,
    scratchCartographic,
  );

  return Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
}

export function toCartesianPositionsWithContext(
  context: TileTransformContext,
  part: [number, number][],
): Cartesian3[] {
  const positions: Cartesian3[] = [];
  for (const point of part) {
    positions.push(tilePointToCartesianWithContext(context, point));
  }
  return positions;
}

export function createPolylineMaterial(color: Color): Material {
  return Material.fromType(Material.ColorType, {
    color: Color.clone(color),
  });
}

export function ensureClosedLoop(positions: Cartesian3[]): Cartesian3[] {
  if (positions.length < 3)
    return positions;

  const first = positions[0];
  const last = positions.at(-1);
  if (
    first.x === last?.x
    && first.y === last.y
    && first.z === last.z
  ) {
    return positions;
  }

  return [...positions, Cartesian3.clone(first)];
}

export function groupPolygonRings(rings: TileGeometryPart[]): PolygonRingGroup[] {
  const classified = classifyRings(
    rings.map(ring =>
      ring.map(([x, y]) => ({
        x,
        y,
      })),
    ),
  );

  return classified.map((polygon) => {
    const [outer, ...holes] = polygon;
    return {
      outer: outer.map(point => [point.x, point.y] as [number, number]),
      holes: holes.map(ring =>
        ring.map(point => [point.x, point.y] as [number, number]),
      ),
    };
  });
}

export function applyOpacity(color: Color, opacity: number | undefined): Color {
  const next = Color.clone(color);
  if (opacity === undefined) {
    return next;
  }

  next.alpha = Math.min(Math.max(next.alpha * opacity, 0), 1);
  return next;
}

export function computeLineStringMidpoint(part: TileGeometryPart): [number, number] {
  if (part.length === 0) {
    return [0, 0];
  }

  if (part.length === 1) {
    return part[0];
  }

  let totalLength = 0;
  for (let index = 0; index < part.length - 1; index += 1) {
    const current = part[index];
    const next = part[index + 1];
    totalLength += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }

  if (totalLength === 0) {
    return part[0];
  }

  const midpoint = totalLength / 2;
  let travelled = 0;
  for (let index = 0; index < part.length - 1; index += 1) {
    const current = part[index];
    const next = part[index + 1];
    const segmentLength = Math.hypot(next[0] - current[0], next[1] - current[1]);
    if (travelled + segmentLength >= midpoint) {
      const ratio = segmentLength === 0 ? 0 : (midpoint - travelled) / segmentLength;
      return [
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ];
    }
    travelled += segmentLength;
  }

  return part.at(-1)!;
}

export function computeRingCentroid(part: TileGeometryPart): [number, number] {
  if (part.length === 0) {
    return [0, 0];
  }

  if (part.length === 1) {
    return part[0];
  }

  let twiceArea = 0;
  let centerX = 0;
  let centerY = 0;

  for (let index = 0; index < part.length; index += 1) {
    const current = part[index];
    const next = part[(index + 1) % part.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    centerX += (current[0] + next[0]) * cross;
    centerY += (current[1] + next[1]) * cross;
  }

  if (twiceArea === 0) {
    const average = part.reduce(
      (accumulator, point) => {
        accumulator[0] += point[0];
        accumulator[1] += point[1];
        return accumulator;
      },
      [0, 0] as [number, number],
    );

    return [average[0] / part.length, average[1] / part.length];
  }

  return [centerX / (3 * twiceArea), centerY / (3 * twiceArea)];
}

export function getFeatureAnchor(
  feature: DecodedFeatureRecord,
): [number, number] | undefined {
  const firstPart = feature.geometry[0];
  if (!firstPart || firstPart.length === 0) {
    return undefined;
  }

  switch (feature.type) {
    case 'Point':
      return firstPart[0];
    case 'LineString':
      return computeLineStringMidpoint(firstPart);
    case 'Polygon':
      return computeRingCentroid(firstPart);
    default:
      return firstPart[0];
  }
}

export function removeAndDestroyPrimitive<T extends { destroy: () => void; isDestroyed: () => boolean }>(
  scene: Scene,
  primitive: T | undefined,
): void {
  if (!primitive)
    return;
  if (primitive.isDestroyed())
    return;

  scene.primitives.remove(primitive);
  if (!primitive.isDestroyed()) {
    primitive.destroy();
  }
}

export function addPrimitiveOrdered<T>(
  scene: Scene,
  orderMap: WeakMap<object, number>,
  primitive: T,
  order: number,
): T {
  const collection = scene.primitives;
  if (collection.contains(primitive as never)) {
    return primitive;
  }

  let insertIndex = collection.length;
  for (let index = 0; index < collection.length; index += 1) {
    const existing = collection.get(index);
    const existingOrder = orderMap.get(existing as object);
    if (existingOrder !== undefined && existingOrder > order) {
      insertIndex = index;
      break;
    }
  }

  collection.add(primitive as never, insertIndex);
  orderMap.set(primitive as object, order);
  return primitive;
}

const EARTH_RADIUS_METERS = 6378137;
const MAPLIBRE_TILE_SIZE = 512;

export function estimateSceneZoom(scene: Scene): number | undefined {
  const camera = scene.camera;
  const cartographic = camera.positionCartographic;
  const height = cartographic?.height;
  if (!Number.isFinite(height) || height <= 0) {
    return undefined;
  }

  const frustum = camera.frustum as { fovy?: number };
  const fovy = Number.isFinite(frustum.fovy) && frustum.fovy ? frustum.fovy : Math.PI / 3;
  const canvasHeight = Math.max(1, scene.canvas.height || 1);
  const latitudeScale = Math.max(
    Math.cos(cartographic.latitude),
    0.0001,
  );
  const visibleMeters = 2 * height * Math.tan(fovy / 2);
  const metersPerPixel = visibleMeters / canvasHeight;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return undefined;
  }

  const zoom = Math.log2(
    (latitudeScale * 2 * Math.PI * EARTH_RADIUS_METERS)
    / (MAPLIBRE_TILE_SIZE * metersPerPixel),
  );

  if (!Number.isFinite(zoom)) {
    return undefined;
  }

  return Math.max(0, Math.min(24, zoom));
}

export function evaluateStyleLayerSortKey(
  compiled: CompiledStyleLayer,
  feature: DecodedFeatureRecord,
  zoom: number,
): number {
  switch (compiled.type) {
    case 'fill':
      return compiled.fill.sortKey?.evaluate(feature, zoom) ?? 0;
    case 'line':
      return compiled.line.sortKey?.evaluate(feature, zoom) ?? 0;
    case 'circle':
      return compiled.circle.sortKey?.evaluate(feature, zoom) ?? 0;
    case 'symbol':
      return compiled.symbol.symbolSortKey?.evaluate(feature, zoom) ?? 0;
    default:
      return 0;
  }
}
