import type { FillLayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  Material,
  Rectangle,
} from 'cesium';
import type { Bucket, FillBucketData, FillBucketStats } from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import type { BucketFillCollectionHandle } from './bucket-fill-backend';
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  ComponentDatatype,
  Ellipsoid,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  MaterialAppearance,
  Primitive,
  PrimitiveType,
  WebMercatorProjection,
  WebMercatorTilingScheme,
} from 'cesium';
import { createFeatureFilter } from '../../style/filter-adapter';
import { validatePositions } from '../../utils/validation';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { iterateFillPolygons, validateFillBucketData } from './fill-bucket-data';
import { getFillPatternMaterial } from './material-cache';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';

interface PatternGroup {
  geometryInstances: GeometryInstance[];
  material: Material;
  polygonCount: number;
}

export interface CreateFillPatternCollectionOptions {
  bucket: Bucket;
  featureStateResolver?: FeatureStateResolver;
  layer: FillLayerSpecification;
  sourceId: string;
  tileKey: string;
  tileWidth?: number;
  zoom: number;
  style: StyleSpecification;
}

const DEFAULT_TILE_WIDTH = 256;
const PROJECTION = new WebMercatorProjection();

const positionScratch = new Cartesian3();
const cartographicScratch = new Cartographic();
const projectedScratch = new Cartesian3();
const normalScratch = new Cartesian3();

export function createFillPatternCollections(
  options: CreateFillPatternCollectionOptions,
): BucketFillCollectionHandle[] {
  const {
    bucket,
    featureStateResolver,
    layer,
    sourceId,
    tileKey,
    tileWidth,
    zoom,
    style,
  } = options;

  const data = bucket.data as FillBucketData;
  const stats = bucket.stats as FillBucketStats;

  if (stats.vertexCount === 0 || data.positions.length === 0) {
    return [];
  }

  if (!validateFillBucketData(data) || !validatePositions(data.positions)) {
    return [];
  }

  const filter = createFeatureFilter(layer.filter);
  const { level, x, y } = parseRenderTileCoordinateFromKey(tileKey);
  const tileRectangle = new WebMercatorTilingScheme().tileXYToNativeRectangle(x, y, level);
  const repeatWidth = Math.max(1, tileWidth ?? DEFAULT_TILE_WIDTH);
  const groups = new Map<Material, PatternGroup>();

  for (const polygon of iterateFillPolygons(data)) {
    const featureIndex = getFeatureIndexEntry(
      bucket.featureIndex.entries,
      polygon.featureId,
    );
    const featureState = featureStateResolver?.({
      id: featureIndex?.id,
      sourceId,
      sourceLayer: bucket.sourceLayer,
    });
    const context = createPrimitiveStyleContext(featureIndex, {
      featureState,
      geometryType: 'Polygon',
      zoom,
    });

    if (context.feature && !filter(context)) {
      continue;
    }

    const material = getFillPatternMaterial(style, layer, context, repeatWidth);
    const geometry = createPatternGeometry(
      polygon.positions,
      polygon.triangles,
      tileRectangle,
    );
    if (!geometry) {
      continue;
    }

    let group = groups.get(material);
    if (!group) {
      group = {
        geometryInstances: [],
        material,
        polygonCount: 0,
      };
      groups.set(material, group);
    }

    group.geometryInstances.push(new GeometryInstance({
      geometry,
      id: featureIndex?.id ?? 0,
    }));
    group.polygonCount += 1;
  }

  if (groups.size === 0) {
    return [];
  }

  const handles: BucketFillCollectionHandle[] = [];
  for (const group of groups.values()) {
    const primitive = new Primitive({
      appearance: new MaterialAppearance({
        flat: true,
        material: group.material,
        materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
        translucent: group.material.isTranslucent(),
      }),
      asynchronous: false,
      geometryInstances: group.geometryInstances,
      releaseGeometryInstances: false,
    });

    handles.push({
      byteLength: calculatePrimitiveByteLength(group.geometryInstances),
      collection: primitive,
      layerId: layer.id,
      polygonCount: group.polygonCount,
    });
  }

  return handles;
}

function createPatternGeometry(
  positions: Float64Array,
  triangles: Uint32Array,
  tileRectangle: Rectangle,
): Geometry | undefined {
  if (positions.length === 0 || triangles.length === 0) {
    return undefined;
  }

  const flatPositions = new Float64Array(positions.length);
  const normals = new Float32Array(positions.length);
  const textureCoordinates = new Float32Array((positions.length / 3) * 2);

  let positionIndex = 0;
  let textureIndex = 0;
  const width = Math.max(1, tileRectangle.east - tileRectangle.west);
  const height = Math.max(1, tileRectangle.north - tileRectangle.south);

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return undefined;
    }

    positionScratch.x = x;
    positionScratch.y = y;
    positionScratch.z = z;

    const cartographic = Cartographic.fromCartesian(
      positionScratch,
      Ellipsoid.WGS84,
      cartographicScratch,
    );
    if (!Number.isFinite(cartographic.longitude) || !Number.isFinite(cartographic.latitude)) {
      return undefined;
    }

    const projected = PROJECTION.project(cartographic, projectedScratch);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return undefined;
    }

    flatPositions[positionIndex] = x;
    flatPositions[positionIndex + 1] = y;
    flatPositions[positionIndex + 2] = z;
    positionIndex += 3;

    const stX = (projected.x - tileRectangle.west) / width;
    const stY = (tileRectangle.north - projected.y) / height;
    if (!Number.isFinite(stX) || !Number.isFinite(stY)) {
      return undefined;
    }

    textureCoordinates[textureIndex] = stX;
    textureCoordinates[textureIndex + 1] = stY;
    textureIndex += 2;

    const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(positionScratch, normalScratch);
    normals[index] = normal.x;
    normals[index + 1] = normal.y;
    normals[index + 2] = normal.z;
  }

  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: flatPositions,
  });
  attributes.normal = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: normals,
  });
  attributes.st = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: textureCoordinates,
  });

  return new Geometry({
    attributes,
    boundingSphere: BoundingSphere.fromVertices(flatPositions),
    indices: triangles,
    primitiveType: PrimitiveType.TRIANGLES,
  });
}

function calculatePrimitiveByteLength(
  geometryInstances: ReadonlyArray<GeometryInstance>,
): number {
  let byteLength = 0;
  for (const instance of geometryInstances) {
    const geometry = instance.geometry as Geometry | undefined;
    if (!geometry) {
      continue;
    }

    const attributes = geometry.attributes;
    byteLength += (attributes.position?.values as ArrayBufferView | undefined)?.byteLength ?? 0;
    byteLength += (attributes.normal?.values as ArrayBufferView | undefined)?.byteLength ?? 0;
    byteLength += (attributes.st?.values as ArrayBufferView | undefined)?.byteLength ?? 0;
    byteLength += (geometry.indices as ArrayBufferView | undefined)?.byteLength ?? 0;
  }

  return byteLength;
}
