import type { VectorTileFeature, VectorTileLayer } from '@mapbox/vector-tile';
import type { ParsedTile } from '../source/vector-tile';
import { listSourceLayers, parseVectorTile } from '../source/vector-tile';

export interface RenderQueryPointGeometry {
  type: 'point';
  x: number;
  y: number;
}

export interface RenderQueryBoxGeometry {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  type: 'box';
}

export type RenderQueryGeometry
  = | RenderQueryPointGeometry
    | RenderQueryBoxGeometry;

export interface SpatialFeatureEntry {
  bounds: SpatialBounds;
  feature: VectorTileFeature;
  geometryType: 'Point' | 'LineString' | 'Polygon';
  sourceIndex: number;
}

export interface SpatialLayerIndex {
  cellSize: number;
  extent: number;
  features: SpatialFeatureEntry[];
  cells: Map<string, number[]>;
}

export interface TileSpatialIndex {
  layers: Map<string, SpatialLayerIndex>;
  sourceLayerNames?: string[];
}

const SPATIAL_INDEX_CACHE = new WeakMap<ArrayBuffer, TileSpatialIndex>();
const DEFAULT_GRID_DIMENSION = 16;
const GEOMETRY_EPSILON = 1e-9;

export function getTileSpatialIndex(tileData: ArrayBuffer): TileSpatialIndex {
  const cachedIndex = SPATIAL_INDEX_CACHE.get(tileData);
  if (cachedIndex) {
    return cachedIndex;
  }

  const index = buildTileSpatialIndex(parseVectorTile(tileData));
  SPATIAL_INDEX_CACHE.set(tileData, index);
  return index;
}

export function querySpatialLayer(
  layerIndex: SpatialLayerIndex,
  geometry?: RenderQueryGeometry,
): SpatialFeatureEntry[] {
  if (!geometry) {
    return layerIndex.features;
  }

  const candidateIndices = collectCandidateIndices(layerIndex, geometry);
  if (candidateIndices.length === 0) {
    return [];
  }

  const features: SpatialFeatureEntry[] = [];
  for (const featureIndex of candidateIndices) {
    const entry = layerIndex.features[featureIndex];
    if (!entry) {
      continue;
    }

    if (!intersectsGeometry(entry.bounds, geometry)) {
      continue;
    }

    if (!intersectsFeatureGeometry(entry, geometry)) {
      continue;
    }

    features.push(entry);
  }

  return features;
}

function buildTileSpatialIndex(tile: ParsedTile): TileSpatialIndex {
  const layers = new Map<string, SpatialLayerIndex>();
  const sourceLayerNames = listSourceLayers(tile);

  for (const sourceLayerName of sourceLayerNames) {
    const sourceLayer = tile.layers[sourceLayerName];
    if (!sourceLayer) {
      continue;
    }

    const layerIndex = buildSourceLayerSpatialIndex(sourceLayer);
    if (layerIndex.features.length === 0) {
      continue;
    }

    layers.set(sourceLayerName, layerIndex);
  }

  return {
    layers,
    sourceLayerNames,
  };
}

function buildSourceLayerSpatialIndex(
  sourceLayer: VectorTileLayer,
): SpatialLayerIndex {
  const extent = sourceLayer.extent;
  const cellSize = getSpatialCellSize(extent);
  const features: SpatialFeatureEntry[] = [];
  const cells = new Map<string, number[]>();

  for (let index = 0; index < sourceLayer.length; index += 1) {
    const feature = sourceLayer.feature(index);
    const geometryType = getGeometryType(feature.type);
    if (!geometryType) {
      continue;
    }

    const geometry = feature.loadGeometry();
    const bounds = getGeometryBounds(geometry);
    if (!bounds) {
      continue;
    }

    const featureIndex = features.push({
      bounds,
      feature,
      geometryType,
      sourceIndex: index,
    }) - 1;

    for (const cellKey of getCoveredCellKeys(bounds, cellSize, extent)) {
      const cellEntries = cells.get(cellKey);
      if (cellEntries) {
        cellEntries.push(featureIndex);
      }
      else {
        cells.set(cellKey, [featureIndex]);
      }
    }
  }

  return {
    cellSize,
    cells,
    extent,
    features,
  };
}

function collectCandidateIndices(
  layerIndex: SpatialLayerIndex,
  geometry: RenderQueryGeometry,
): number[] {
  const bounds = geometry.type === 'point'
    ? {
        maxX: geometry.x,
        maxY: geometry.y,
        minX: geometry.x,
        minY: geometry.y,
      }
    : geometry;

  const candidateIndices = new Set<number>();
  for (const cellKey of getCoveredCellKeys(bounds, layerIndex.cellSize, layerIndex.extent)) {
    const cellEntries = layerIndex.cells.get(cellKey);
    if (!cellEntries) {
      continue;
    }

    for (const featureIndex of cellEntries) {
      candidateIndices.add(featureIndex);
    }
  }

  const candidateList: number[] = [];
  for (const featureIndex of candidateIndices) {
    candidateList.push(featureIndex);
  }

  candidateList.sort((left, right) => left - right);
  return candidateList;
}

function getCoveredCellKeys(
  bounds: SpatialBounds,
  cellSize: number,
  extent: number,
): string[] {
  const maxCellIndex = Math.max(0, Math.ceil(extent / cellSize) - 1);
  const minX = clampCellIndex(Math.floor(bounds.minX / cellSize), maxCellIndex);
  const maxX = clampCellIndex(Math.floor(bounds.maxX / cellSize), maxCellIndex);
  const minY = clampCellIndex(Math.floor(bounds.minY / cellSize), maxCellIndex);
  const maxY = clampCellIndex(Math.floor(bounds.maxY / cellSize), maxCellIndex);

  const keys: string[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      keys.push(createCellKey(x, y));
    }
  }

  return keys;
}

function intersectsGeometry(
  bounds: SpatialBounds,
  geometry: RenderQueryGeometry,
): boolean {
  if (geometry.type === 'point') {
    return containsPoint(bounds, geometry.x, geometry.y);
  }

  return intersectsBounds(bounds, geometry);
}

function intersectsFeatureGeometry(
  entry: SpatialFeatureEntry,
  geometry: RenderQueryGeometry,
): boolean {
  const featureGeometry = entry.feature.loadGeometry() as GeometryParts;

  if (geometry.type === 'point') {
    return intersectsPointGeometry(featureGeometry, entry.geometryType, geometry);
  }

  return intersectsBoxGeometry(featureGeometry, entry.geometryType, geometry);
}

function intersectsPointGeometry(
  geometry: GeometryParts,
  geometryType: SpatialFeatureEntry['geometryType'],
  point: RenderQueryPointGeometry,
): boolean {
  switch (geometryType) {
    case 'Point':
      return geometry.some(part => part.some(entryPoint => entryPoint.x === point.x && entryPoint.y === point.y));
    case 'LineString':
      return geometry.some(part => lineStringContainsPoint(part, point));
    case 'Polygon':
      return pointInPolygon(geometry, point.x, point.y);
    default:
      return false;
  }
}

function intersectsBoxGeometry(
  geometry: GeometryParts,
  geometryType: SpatialFeatureEntry['geometryType'],
  box: RenderQueryBoxGeometry,
): boolean {
  switch (geometryType) {
    case 'Point':
      return geometry.some(part => part.some(point => containsPoint(box, point.x, point.y)));
    case 'LineString':
      return geometry.some(part => lineStringIntersectsBox(part, box));
    case 'Polygon':
      return polygonIntersectsBox(geometry, box);
    default:
      return false;
  }
}

function lineStringContainsPoint(
  line: GeometryPart,
  point: RenderQueryPointGeometry,
): boolean {
  for (const vertex of line) {
    if (vertex.x === point.x && vertex.y === point.y) {
      return true;
    }
  }

  for (let index = 1; index < line.length; index += 1) {
    if (pointOnSegment(point, line[index - 1], line[index])) {
      return true;
    }
  }

  return false;
}

function lineStringIntersectsBox(
  line: GeometryPart,
  box: RenderQueryBoxGeometry,
): boolean {
  for (const point of line) {
    if (containsPoint(box, point.x, point.y)) {
      return true;
    }
  }

  for (let index = 1; index < line.length; index += 1) {
    if (segmentIntersectsBox(line[index - 1], line[index], box)) {
      return true;
    }
  }

  return false;
}

function polygonIntersectsBox(
  geometry: GeometryParts,
  box: RenderQueryBoxGeometry,
): boolean {
  for (const part of geometry) {
    for (const point of part) {
      if (containsPoint(box, point.x, point.y)) {
        return true;
      }
    }
  }

  if (
    pointInPolygon(geometry, box.minX, box.minY)
    || pointInPolygon(geometry, box.minX, box.maxY)
    || pointInPolygon(geometry, box.maxX, box.minY)
    || pointInPolygon(geometry, box.maxX, box.maxY)
  ) {
    return true;
  }

  return geometry.some(part => lineStringIntersectsBox(part, box));
}

function pointInPolygon(
  geometry: GeometryParts,
  x: number,
  y: number,
): boolean {
  let inside = false;

  for (const part of geometry) {
    if (part.length < 2) {
      continue;
    }

    for (let index = 0, previous = part.length - 1; index < part.length; previous = index, index += 1) {
      const currentPoint = part[index];
      const previousPoint = part[previous];

      if (pointOnSegment({ x, y }, previousPoint, currentPoint)) {
        return true;
      }

      const intersects = ((currentPoint.y > y) !== (previousPoint.y > y))
        && x < ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
      if (intersects) {
        inside = !inside;
      }
    }
  }

  return inside;
}

function segmentIntersectsBox(
  start: GeometryPoint,
  end: GeometryPoint,
  box: RenderQueryBoxGeometry,
): boolean {
  if (containsPoint(box, start.x, start.y) || containsPoint(box, end.x, end.y)) {
    return true;
  }

  const topLeft: GeometryPoint = { x: box.minX, y: box.minY };
  const topRight: GeometryPoint = { x: box.maxX, y: box.minY };
  const bottomRight: GeometryPoint = { x: box.maxX, y: box.maxY };
  const bottomLeft: GeometryPoint = { x: box.minX, y: box.maxY };

  return segmentsIntersect(start, end, topLeft, topRight)
    || segmentsIntersect(start, end, topRight, bottomRight)
    || segmentsIntersect(start, end, bottomRight, bottomLeft)
    || segmentsIntersect(start, end, bottomLeft, topLeft);
}

function segmentsIntersect(
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint,
  d: GeometryPoint,
): boolean {
  const orientation1 = getOrientation(a, b, c);
  const orientation2 = getOrientation(a, b, d);
  const orientation3 = getOrientation(c, d, a);
  const orientation4 = getOrientation(c, d, b);

  if (orientation1 !== orientation2 && orientation3 !== orientation4) {
    return true;
  }

  if (orientation1 === 0 && pointOnSegment(c, a, b)) {
    return true;
  }
  if (orientation2 === 0 && pointOnSegment(d, a, b)) {
    return true;
  }
  if (orientation3 === 0 && pointOnSegment(a, c, d)) {
    return true;
  }
  if (orientation4 === 0 && pointOnSegment(b, c, d)) {
    return true;
  }

  return false;
}

function getOrientation(
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint,
): 0 | 1 | 2 {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) <= GEOMETRY_EPSILON) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function pointOnSegment(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > GEOMETRY_EPSILON) {
    return false;
  }

  const minX = Math.min(start.x, end.x) - GEOMETRY_EPSILON;
  const maxX = Math.max(start.x, end.x) + GEOMETRY_EPSILON;
  const minY = Math.min(start.y, end.y) - GEOMETRY_EPSILON;
  const maxY = Math.max(start.y, end.y) + GEOMETRY_EPSILON;

  return point.x >= minX
    && point.x <= maxX
    && point.y >= minY
    && point.y <= maxY;
}

function getGeometryBounds(
  geometry: GeometryParts,
): SpatialBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hasPoint = false;

  for (const part of geometry) {
    for (const point of part) {
      hasPoint = true;
      if (point.x < minX)
        minX = point.x;
      if (point.y < minY)
        minY = point.y;
      if (point.x > maxX)
        maxX = point.x;
      if (point.y > maxY)
        maxY = point.y;
    }
  }

  if (!hasPoint) {
    return undefined;
  }

  return {
    maxX,
    maxY,
    minX,
    minY,
  };
}

function getSpatialCellSize(extent: number): number {
  return Math.max(1, Math.ceil(extent / DEFAULT_GRID_DIMENSION));
}

function getGeometryType(type: 0 | 1 | 2 | 3) {
  switch (type) {
    case 1:
      return 'Point';
    case 2:
      return 'LineString';
    case 3:
      return 'Polygon';
    default:
      return undefined;
  }
}

function containsPoint(
  bounds: SpatialBounds,
  x: number,
  y: number,
): boolean {
  return x >= bounds.minX
    && x <= bounds.maxX
    && y >= bounds.minY
    && y <= bounds.maxY;
}

function intersectsBounds(
  left: SpatialBounds,
  right: SpatialBounds,
): boolean {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minY <= right.maxY
    && left.maxY >= right.minY;
}

function clampCellIndex(index: number, maxCellIndex: number): number {
  if (index < 0) {
    return 0;
  }
  if (index > maxCellIndex) {
    return maxCellIndex;
  }
  return index;
}

function createCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

interface SpatialBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface GeometryPoint {
  x: number;
  y: number;
}

type GeometryPart = GeometryPoint[];

type GeometryParts = GeometryPart[];
