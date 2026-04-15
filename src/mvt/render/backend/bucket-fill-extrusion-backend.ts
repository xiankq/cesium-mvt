import type {
  FillExtrusionLayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { Cartesian3, Material } from 'cesium';
import type {
  Bucket,
  FillBucketData,
  FillBucketStats,
  FillExtrusionBucketStats,
  ParsedTileResult,
} from '../../bucket/bucket-types';
import type { FeatureStateResolver } from '../../style/feature-state-store';
import type { StyleIndex } from '../../style/style-manager';
import {
  Cartesian3 as CesiumCartesian3,
  GeometryInstance,
  MaterialAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
} from 'cesium';
import { createFeatureFilter } from '../../style/filter-adapter';
import { createFillExtrusionLayerStyleResolver } from '../../style/layer-style-resolver';
import { validatePositions } from '../../utils/validation';
import { parseRenderTileCoordinateFromKey } from '../render-tile';
import { iterateFillPolygons, validateFillBucketData } from './fill-bucket-data';
import { getFillExtrusionMaterial } from './material-cache';
import {
  createPrimitiveStyleContext,
  getFeatureIndexEntry,
} from './primitive-style';

interface ExtrusionGroup {
  geometryInstances: GeometryInstance[];
  material: Material;
  polygonCount: number;
}

export interface BucketFillExtrusionCollectionHandle {
  byteLength: number;
  collection: Primitive;
  layerId: string;
  polygonCount: number;
}

export interface BucketFillExtrusionTileHandle {
  byteLength: number;
  collections: BucketFillExtrusionCollectionHandle[];
  key: string;
}

export interface CreateBucketFillExtrusionTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  style: StyleSpecification;
  styleIndex?: StyleIndex;
  tileWidth?: number;
}

const DEFAULT_TILE_WIDTH = 256;

export function createBucketFillExtrusionTileHandle({
  bucketTile,
  featureStateResolver,
  style,
  styleIndex,
  tileWidth,
}: CreateBucketFillExtrusionTileHandleOptions): BucketFillExtrusionTileHandle | undefined {
  const extrusionBuckets = bucketTile.buckets.filter(isFillExtrusionBucket);
  if (extrusionBuckets.length === 0) {
    return undefined;
  }

  const { level: zoom, sourceId } = parseRenderTileCoordinateFromKey(bucketTile.key);
  const layersById = styleIndex?.layersById ?? new Map(
    style.layers.map(layer => [layer.id, layer]),
  );
  const collections: BucketFillExtrusionCollectionHandle[] = [];

  for (const bucket of extrusionBuckets) {
    const stats = bucket.stats as FillExtrusionBucketStats | FillBucketStats;
    const data = bucket.data as FillBucketData;

    if (stats.vertexCount === 0 || data.positions.length === 0) {
      continue;
    }

    if (!validateFillBucketData(data) || !validatePositions(data.positions)) {
      continue;
    }

    for (const layerId of bucket.layerIds) {
      const layer = layersById.get(layerId);
      if (!layer || !isFillExtrusionLayer(layer)) {
        continue;
      }

      const collection = createExtrusionCollection({
        bucket,
        featureStateResolver,
        layer,
        sourceId,
        style,
        tileWidth,
        zoom,
      });
      if (collection) {
        collections.push(...collection);
      }
    }
  }

  if (collections.length === 0) {
    return undefined;
  }

  return {
    byteLength: collections.reduce((total, entry) => total + entry.byteLength, 0),
    collections,
    key: bucketTile.key,
  };
}

function createExtrusionCollection({
  bucket,
  featureStateResolver,
  layer,
  sourceId,
  style,
  tileWidth,
  zoom,
}: {
  bucket: Bucket;
  featureStateResolver: FeatureStateResolver | undefined;
  layer: FillExtrusionLayerSpecification;
  sourceId: string;
  style: StyleSpecification;
  tileWidth: number | undefined;
  zoom: number;
}): BucketFillExtrusionCollectionHandle[] | undefined {
  const data = bucket.data as FillBucketData;
  const filter = createFeatureFilter(layer.filter);
  const resolveStyle = createFillExtrusionLayerStyleResolver(layer);
  const repeatWidth = Math.max(1, tileWidth ?? DEFAULT_TILE_WIDTH);
  const groups = new Map<Material, ExtrusionGroup>();

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

    const resolvedStyle = resolveStyle(context);
    const material = getFillExtrusionMaterial(style, layer, context, repeatWidth);
    const hierarchy = createPolygonHierarchy(polygon.positions, polygon.holes);
    if (!hierarchy) {
      continue;
    }

    const geometry = new PolygonGeometry({
      extrudedHeight: resolvedStyle.height,
      height: resolvedStyle.base,
      perPositionHeight: false,
      polygonHierarchy: hierarchy,
      vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    });

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
    return undefined;
  }

  const primitives: BucketFillExtrusionCollectionHandle[] = [];
  for (const group of groups.values()) {
    const primitive = new Primitive({
      appearance: new MaterialAppearance({
        closed: true,
        material: group.material,
        materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
        translucent: group.material.isTranslucent(),
      }),
      asynchronous: false,
      geometryInstances: group.geometryInstances,
      releaseGeometryInstances: false,
    });

    primitives.push({
      byteLength: calculatePrimitiveByteLength(group.geometryInstances),
      collection: primitive,
      layerId: layer.id,
      polygonCount: group.polygonCount,
    });
  }

  return primitives;
}

function createPolygonHierarchy(
  positions: Float64Array,
  holeOffsets: Uint32Array,
): PolygonHierarchy | undefined {
  const vertexCount = positions.length / 3;
  if (!Number.isInteger(vertexCount) || vertexCount < 3) {
    return undefined;
  }

  if (holeOffsets.length === 0) {
    const outer = createCartesianPositions(positions, 0, vertexCount);
    return outer.length >= 3
      ? new PolygonHierarchy(outer)
      : undefined;
  }

  const ringStarts: number[] = [0];
  const ringEnds: number[] = [];
  for (let index = 0; index < holeOffsets.length; index += 1) {
    const holeOffset = holeOffsets[index]!;
    ringStarts.push(holeOffset);
    ringEnds.push(holeOffset);
  }
  ringEnds.push(vertexCount);

  if (ringStarts.some(start => start < 0 || start >= vertexCount)) {
    return undefined;
  }

  const outer = createCartesianPositions(positions, ringStarts[0]!, ringEnds[0]!);
  if (outer.length < 3) {
    return undefined;
  }

  const holes: PolygonHierarchy[] = [];
  for (let index = 1; index < ringStarts.length; index += 1) {
    const ring = createCartesianPositions(
      positions,
      ringStarts[index]!,
      ringEnds[index]!,
    );
    if (ring.length < 3) {
      return undefined;
    }

    holes.push(new PolygonHierarchy(ring));
  }

  return new PolygonHierarchy(outer, holes);
}

function createCartesianPositions(
  positions: Float64Array,
  startVertex: number,
  endVertex: number,
): Cartesian3[] {
  const result: Cartesian3[] = [];
  for (let index = startVertex; index < endVertex; index += 1) {
    const positionIndex = index * 3;
    const x = positions[positionIndex]!;
    const y = positions[positionIndex + 1]!;
    const z = positions[positionIndex + 2]!;
    result.push(new CesiumCartesian3(x, y, z));
  }

  return result;
}

function calculatePrimitiveByteLength(
  geometryInstances: ReadonlyArray<GeometryInstance>,
): number {
  let byteLength = 0;
  for (const instance of geometryInstances) {
    const geometry = instance.geometry;
    if (!(geometry instanceof PolygonGeometry)) {
      continue;
    }

    const geometryData = PolygonGeometry.createGeometry(geometry);
    if (!geometryData) {
      continue;
    }

    const attributes = geometryData.attributes;
    byteLength += (attributes.position?.values as ArrayBufferView | undefined)?.byteLength ?? 0;
    byteLength += (attributes.normal?.values as ArrayBufferView | undefined)?.byteLength ?? 0;
    byteLength += (attributes.st?.values as ArrayBufferView | undefined)?.byteLength ?? 0;
    byteLength += (geometryData.indices as ArrayBufferView | undefined)?.byteLength ?? 0;
  }

  return byteLength;
}

function isFillExtrusionBucket(
  bucket: Bucket,
): bucket is Bucket & { data: FillBucketData } {
  return bucket.type === 'fill-extrusion';
}

function isFillExtrusionLayer(
  layer: StyleSpecification['layers'][number],
): layer is FillExtrusionLayerSpecification {
  return layer.type === 'fill-extrusion';
}
