import type { StyleSet } from '../style/style-set';
import type { BucketFeature, ParsedTileData, RenderableLayerType, StyleFamily, TileBucket, VectorGeometryType } from '../types';
import type { WarningContext } from '../warning-context';
import { classifyRings, VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { warnOnce } from '../warning-context';

interface BucketCollector {
  bucket: Omit<TileBucket, 'byteLength' | 'featureCount' | 'features' | 'vertexCount'>;
  filterEvaluator: StyleFamily['layers'][number]['filterEvaluator'];
  features: BucketFeature[];
  vertexCount: number;
}

export function parseVectorTile(
  arrayBuffer: ArrayBuffer,
  styleSet: StyleSet,
  zoom: number,
  warningContext?: WarningContext,
): ParsedTileData {
  const vectorTile = new VectorTile(new Pbf(new Uint8Array(arrayBuffer)));
  const familiesBySourceLayer = groupFamiliesBySourceLayer(styleSet.families);
  const buckets: TileBucket[] = [];

  for (const [sourceLayer, families] of familiesBySourceLayer) {
    const vectorTileLayer = vectorTile.layers[sourceLayer];
    if (!vectorTileLayer) {
      continue;
    }

    const collectors = families.map(family => createBucketCollector(family, vectorTileLayer.extent));

    for (let featureIndex = 0; featureIndex < vectorTileLayer.length; featureIndex += 1) {
      const vectorTileFeature = vectorTileLayer.feature(featureIndex);
      const geometryType = resolveVectorGeometryType(vectorTileFeature);
      if (!geometryType) {
        warnOnce(
          warningContext,
          `parse:geometry-type:${vectorTileFeature.type}`,
          'MVT 数据中存在当前未支持的几何类型，已跳过该要素。',
          {
            featureType: vectorTileFeature.type,
            sourceLayer,
          },
        );
        continue;
      }

      const matchingCollectors = collectors.filter((collector) => {
        return isGeometryCompatible(collector.bucket.type, geometryType)
          && collector.filterEvaluator({
            geometryType,
            id: vectorTileFeature.id,
            properties: vectorTileFeature.properties,
          }, zoom);
      });
      if (!matchingCollectors.length) {
        continue;
      }

      const bucketFeature = createBucketFeature(vectorTileFeature, geometryType);
      const vertexCount = countBucketFeatureVertices(bucketFeature);
      for (const collector of matchingCollectors) {
        collector.features.push(bucketFeature);
        collector.vertexCount += vertexCount;
      }
    }

    for (const collector of collectors) {
      if (!collector.features.length) {
        continue;
      }

      const byteLength = estimateBucketByteLength(collector.features, collector.vertexCount);
      buckets.push({
        ...collector.bucket,
        byteLength,
        featureCount: collector.features.length,
        features: collector.features,
        vertexCount: collector.vertexCount,
      });
    }
  }

  return {
    bucketCount: buckets.length,
    buckets,
    byteLength: buckets.reduce((total, bucket) => total + bucket.byteLength, 0),
    sourceLayers: [...familiesBySourceLayer.keys()],
  };
}

function countBucketFeatureVertices(feature: BucketFeature): number {
  if (feature.geometryType === 'Polygon') {
    return feature.geometry.reduce((polygonTotal, polygon) => {
      return polygonTotal + polygon.reduce((ringTotal, ring) => ringTotal + ring.length, 0);
    }, 0);
  }

  return feature.geometry.reduce((total, part) => total + part.length, 0);
}

function createBucketCollector(family: StyleFamily, extent: number): BucketCollector {
  const bucketType = family.type as Exclude<RenderableLayerType, 'background'>;

  return {
    bucket: {
      extent,
      familyKey: family.key,
      layerIds: family.layers.map(layer => layer.id),
      sourceLayer: family.sourceLayer!,
      type: bucketType,
    },
    features: [],
    filterEvaluator: family.layers[0].filterEvaluator,
    vertexCount: 0,
  };
}

function createBucketFeature(
  vectorTileFeature: VectorTileFeature,
  geometryType: VectorGeometryType,
): BucketFeature {
  const geometry = vectorTileFeature.loadGeometry();
  if (geometryType === 'Polygon') {
    return {
      geometry: classifyRings(geometry),
      geometryType,
      id: vectorTileFeature.id,
      properties: vectorTileFeature.properties,
    };
  }

  return {
    geometry,
    geometryType,
    id: vectorTileFeature.id,
    properties: vectorTileFeature.properties,
  };
}

function estimateBucketByteLength(features: readonly BucketFeature[], vertexCount: number): number {
  let propertyCount = 0;
  for (const feature of features) {
    propertyCount += Object.keys(feature.properties).length;
  }

  return vertexCount * 16 + propertyCount * 24 + features.length * 48;
}

function groupFamiliesBySourceLayer(families: readonly StyleFamily[]): Map<string, StyleFamily[]> {
  const familiesBySourceLayer = new Map<string, StyleFamily[]>();
  for (const family of families) {
    if (!family.sourceLayer) {
      continue;
    }

    const sourceLayerFamilies = familiesBySourceLayer.get(family.sourceLayer);
    if (sourceLayerFamilies) {
      sourceLayerFamilies.push(family);
      continue;
    }

    familiesBySourceLayer.set(family.sourceLayer, [family]);
  }

  return familiesBySourceLayer;
}

function isGeometryCompatible(
  bucketType: TileBucket['type'],
  geometryType: VectorGeometryType,
): boolean {
  switch (bucketType) {
    case 'fill':
      return geometryType === 'Polygon';
    case 'line':
      return geometryType === 'LineString';
    case 'circle':
      return geometryType === 'Point';
    case 'symbol':
      return true;
  }
}

function resolveVectorGeometryType(vectorTileFeature: VectorTileFeature): VectorGeometryType | undefined {
  const geometryType = VectorTileFeature.types[vectorTileFeature.type];
  if (geometryType === 'Point' || geometryType === 'LineString' || geometryType === 'Polygon') {
    return geometryType;
  }

  return undefined;
}
