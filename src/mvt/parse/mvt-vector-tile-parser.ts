import type { MvtBucketFeature, MvtParsedTileData, MvtRenderableLayerType, MvtStyleFamily, MvtTileBucket, MvtVectorGeometryType } from '../mvt-types';
import type { MvtWarningContext } from '../mvt-warning-context';
import type { MvtStyleSet } from '../style/mvt-style-set';
import { classifyRings, VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { warnMvtOnce } from '../mvt-warning-context';

interface BucketCollector {
  bucket: Omit<MvtTileBucket, 'byteLength' | 'featureCount' | 'features' | 'vertexCount'>;
  filterEvaluator: MvtStyleFamily['layers'][number]['filterEvaluator'];
  features: MvtBucketFeature[];
  vertexCount: number;
}

export function parseMvtVectorTile(
  arrayBuffer: ArrayBuffer,
  styleSet: MvtStyleSet,
  zoom: number,
  warningContext?: MvtWarningContext,
): MvtParsedTileData {
  const vectorTile = new VectorTile(new Pbf(new Uint8Array(arrayBuffer)));
  const familiesBySourceLayer = groupFamiliesBySourceLayer(styleSet.families);
  const buckets: MvtTileBucket[] = [];

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
        warnMvtOnce(
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

function countBucketFeatureVertices(feature: MvtBucketFeature): number {
  if (feature.geometryType === 'Polygon') {
    return feature.geometry.reduce((polygonTotal, polygon) => {
      return polygonTotal + polygon.reduce((ringTotal, ring) => ringTotal + ring.length, 0);
    }, 0);
  }

  return feature.geometry.reduce((total, part) => total + part.length, 0);
}

function createBucketCollector(family: MvtStyleFamily, extent: number): BucketCollector {
  const bucketType = family.type as Exclude<MvtRenderableLayerType, 'background'>;

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
  geometryType: MvtVectorGeometryType,
): MvtBucketFeature {
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

function estimateBucketByteLength(features: readonly MvtBucketFeature[], vertexCount: number): number {
  let propertyCount = 0;
  for (const feature of features) {
    propertyCount += Object.keys(feature.properties).length;
  }

  return vertexCount * 16 + propertyCount * 24 + features.length * 48;
}

function groupFamiliesBySourceLayer(families: readonly MvtStyleFamily[]): Map<string, MvtStyleFamily[]> {
  const familiesBySourceLayer = new Map<string, MvtStyleFamily[]>();
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
  bucketType: MvtTileBucket['type'],
  geometryType: MvtVectorGeometryType,
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

function resolveVectorGeometryType(vectorTileFeature: VectorTileFeature): MvtVectorGeometryType | undefined {
  const geometryType = VectorTileFeature.types[vectorTileFeature.type];
  if (geometryType === 'Point' || geometryType === 'LineString' || geometryType === 'Polygon') {
    return geometryType;
  }

  return undefined;
}
