import type { Cartesian3, TilingScheme } from '@cesium/engine';
import type { MvtDisplayFeatureCache } from '../mesh/mvt-display-feature';
import type {
  MvtBucketFeature,
  MvtCompiledStyleLayer,
  MvtMeshIndexArray,
  MvtParsedTileData,
  MvtPolygonBucketFeature,
  MvtTileCoordinate,
} from '../mvt-types';
import type { MvtWarningContext } from '../mvt-warning-context';
import type { MvtStyleSet } from '../style/mvt-style-set';
import type { MvtFeatureMaterialCache } from './mvt-style-material';
import type { MvtTileRenderableLike } from './mvt-symbol-renderable';
import {
  BufferPoint,
  BufferPointCollection,
  BufferPointMaterial,
  BufferPolygon,
  BufferPolygonCollection,
  BufferPolygonMaterial,
  BufferPolyline,
  BufferPolylineCollection,
  BufferPolylineMaterial,
  ComponentDatatype,
  IndexDatatype,
} from '@cesium/engine';
import earcut from 'earcut';
import { getClippedDisplayFeature } from '../mesh/mvt-display-feature';
import { normalizePolylinePoints, normalizeRingPoints } from '../mesh/mvt-geometry-normalize';
import { warnUnsupportedLayerProperty } from '../mvt-warning-context';
import { sortBucketFeaturesForLayer } from './mvt-feature-sort';
import { getLayerHeightOffset, liftLocalPosition } from './mvt-layer-height';
import { splitPolylineByDashPattern } from './mvt-line-dash';
import {
  getTileUnitsPerPixel,
  offsetPolylineInTileSpace,
  translateTilePoint,
  translateTilePoints,
} from './mvt-style-geometry';
import { createFeatureMaterial } from './mvt-style-material';
import { resolveCircleStyleRule, resolveFillStyleRule, resolveLineStyleRule } from './mvt-style-rule';
import { MvtSymbolCollisionIndex } from './mvt-symbol-collision';
import { createSymbolRenderable } from './mvt-symbol-renderable';
import { createMvtTileTransform, projectTilePointToLocalCartesian } from './mvt-tile-transform';

type CesiumIndexDatatype = typeof IndexDatatype & {
  createTypedArray: (numberOfVertices: number, indicesLengthOrArray: number[] | number) => MvtMeshIndexArray;
};

interface MvtPointRenderItem {
  material: BufferPointMaterial;
  position: Cartesian3;
}

interface MvtPolygonRenderItem {
  holes?: Uint32Array;
  holeCount: number;
  material: BufferPolygonMaterial;
  positions: Float64Array;
  triangleCount: number;
  triangles: MvtMeshIndexArray;
  vertexCount: number;
}

interface MvtPolylineRenderItem {
  material: BufferPolylineMaterial;
  positions: Float64Array;
  vertexCount: number;
}

interface MvtStaticRenderable {
  byteLength: number;
  destroy: () => void;
  order: number;
  update: (frameState: unknown) => void;
}

interface MvtSymbolEntry {
  extent: number;
  features: readonly MvtBucketFeature[];
  layer: MvtCompiledStyleLayer;
}

export interface MvtTileRenderBundle {
  readonly byteLength: number;
  destroy: () => void;
  isDestroyed: () => boolean;
  update: (
    frameState: unknown,
    renderZoom?: number,
    symbolCollisionIndex?: MvtSymbolCollisionIndex,
  ) => void;
}

export interface MvtTileRenderBundleOptions {
  coordinate: MvtTileCoordinate;
  displayFeatureCache?: MvtDisplayFeatureCache;
  parsedTileData: MvtParsedTileData;
  sourceCoordinate?: MvtTileCoordinate;
  styleSet: MvtStyleSet;
  tilingScheme: TilingScheme;
  warningContext?: MvtWarningContext;
}

const indexDatatype = IndexDatatype as CesiumIndexDatatype;

export function createMvtTileRenderBundle(options: MvtTileRenderBundleOptions): MvtTileRenderBundle {
  const transform = createMvtTileTransform(
    options.tilingScheme,
    options.coordinate,
    options.sourceCoordinate ?? options.coordinate,
  );
  const materialCache: MvtFeatureMaterialCache = new Map();
  let destroyed = false;
  let byteLength = 0;
  let lastBuiltZoom: number | undefined;
  let staticByteLength = 0;
  let symbolByteLength = 0;
  let staticRenderables: MvtStaticRenderable[] = [];
  let symbolEntries: MvtSymbolEntry[] = [];
  let symbolRenderables: MvtTileRenderableLike[] = [];

  rebuildForZoom(options.coordinate.z);

  return {
    get byteLength() {
      return byteLength;
    },
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      destroyStaticRenderables();
      destroySymbolRenderables();
      materialCache.clear();
    },
    isDestroyed: () => destroyed,
    update: (
      frameState: unknown,
      renderZoom = options.coordinate.z,
      symbolCollisionIndex = new MvtSymbolCollisionIndex(),
    ) => {
      if (destroyed) {
        return;
      }

      if (lastBuiltZoom !== renderZoom) {
        rebuildForZoom(renderZoom);
      }
      if (!canUpdateCesiumCollections(frameState)) {
        for (const renderable of symbolRenderables) {
          renderable.update(frameState, symbolCollisionIndex);
        }
        return;
      }

      for (const renderable of staticRenderables) {
        renderable.update(frameState);
      }
      for (const renderable of symbolRenderables) {
        renderable.update(frameState, symbolCollisionIndex);
      }
    },
  };

  function destroyStaticRenderables(): void {
    for (const renderable of staticRenderables) {
      renderable.destroy();
    }
    staticRenderables = [];
    staticByteLength = 0;
    byteLength = symbolByteLength;
  }

  function destroySymbolRenderables(): void {
    for (const renderable of symbolRenderables) {
      renderable.destroy();
    }
    symbolRenderables = [];
    symbolByteLength = 0;
    byteLength = staticByteLength;
  }

  function rebuildForZoom(renderZoom: number): void {
    destroyStaticRenderables();
    destroySymbolRenderables();
    symbolEntries = [];

    const nextStaticRenderables: MvtStaticRenderable[] = [];
    for (const bucket of options.parsedTileData.buckets) {
      for (const layerId of bucket.layerIds) {
        const layer = options.styleSet.getCompiledLayer(layerId);
        if (!layer || !options.styleSet.isLayerVisibleAtZoom(layer, renderZoom)) {
          continue;
        }

        const features = sortBucketFeaturesForLayer(options.styleSet, layer, renderZoom, bucket.features);
        if (layer.type === 'symbol') {
          symbolEntries.push({
            extent: bucket.extent,
            features,
            layer,
          });
          continue;
        }

        const renderable = createStaticRenderable({
          displayFeatureCache: options.displayFeatureCache,
          extent: bucket.extent,
          features,
          layer,
          materialCache,
          renderZoom,
          styleSet: options.styleSet,
          transform,
          warningContext: options.warningContext,
        });
        if (!renderable) {
          continue;
        }

        nextStaticRenderables.push({
          ...renderable,
          order: layer.order,
        });
      }
    }

    nextStaticRenderables.sort((left, right) => left.order - right.order);
    symbolEntries.sort((left, right) => left.layer.order - right.layer.order);
    staticRenderables = nextStaticRenderables;
    staticByteLength = staticRenderables.reduce((total, renderable) => total + renderable.byteLength, 0);
    lastBuiltZoom = renderZoom;
    rebuildSymbolRenderables(new MvtSymbolCollisionIndex(), renderZoom);
  }

  function rebuildSymbolRenderables(
    symbolCollisionIndex: MvtSymbolCollisionIndex,
    renderZoom: number,
  ): void {
    destroySymbolRenderables();

    const nextSymbolRenderables: MvtTileRenderableLike[] = [];
    for (const entry of symbolEntries) {
      const renderable = createSymbolRenderable(
        options.styleSet,
        entry.features,
        entry.extent,
        entry.layer,
        renderZoom,
        transform,
        symbolCollisionIndex,
        options.displayFeatureCache,
        options.warningContext,
      );
      if (!renderable) {
        continue;
      }

      nextSymbolRenderables.push(renderable);
    }

    symbolRenderables = nextSymbolRenderables;
    symbolByteLength = symbolRenderables.reduce((total, renderable) => total + renderable.byteLength, 0);
    byteLength = staticByteLength + symbolByteLength;
  }
}

function canUpdateCesiumCollections(frameState: unknown): frameState is { commandList: unknown[]; context: object } {
  if (!frameState || typeof frameState !== 'object') {
    return false;
  }

  const candidate = frameState as Record<string, unknown>;
  return Array.isArray(candidate.commandList) && typeof candidate.context === 'object' && candidate.context !== null;
}

interface CreateStaticRenderableOptions {
  displayFeatureCache?: MvtDisplayFeatureCache;
  extent: number;
  features: readonly MvtBucketFeature[];
  layer: MvtCompiledStyleLayer;
  materialCache: MvtFeatureMaterialCache;
  renderZoom: number;
  styleSet: MvtStyleSet;
  transform: ReturnType<typeof createMvtTileTransform>;
  warningContext?: MvtWarningContext;
}

function createStaticRenderable(
  options: CreateStaticRenderableOptions,
): Omit<MvtStaticRenderable, 'order'> | undefined {
  warnUnsupportedStaticLayerProperties(options.layer, options.warningContext);

  switch (options.layer.type) {
    case 'fill':
      return createPolygonRenderable(options);
    case 'line':
      return createPolylineRenderable(options);
    case 'circle':
      return createPointRenderable(options);
    case 'background':
    case 'symbol':
      return undefined;
  }
}

function createPointRenderable(
  options: CreateStaticRenderableOptions,
): Omit<MvtStaticRenderable, 'order'> | undefined {
  const items: MvtPointRenderItem[] = [];
  const heightOffset = getLayerHeightOffset(options.layer);

  for (const feature of options.features) {
    if (feature.geometryType !== 'Point') {
      continue;
    }

    const displayFeature = getClippedDisplayFeature(
      feature,
      options.extent,
      options.transform,
      options.displayFeatureCache,
    );
    if (!displayFeature || displayFeature.geometryType !== 'Point') {
      continue;
    }

    const styleRule = resolveCircleStyleRule(options.styleSet, options.layer, options.renderZoom, feature);
    if (!styleRule.visible) {
      continue;
    }

    const material = createFeatureMaterial(
      options.styleSet,
      options.layer,
      options.renderZoom,
      feature,
      options.materialCache,
    );
    if (!(material instanceof BufferPointMaterial)) {
      continue;
    }

    for (const part of displayFeature.geometry) {
      for (const point of part) {
        items.push({
          material,
          position: liftLocalPosition(
            projectTilePointToLocalCartesian(
              translateTilePoint(point, options.extent, styleRule.translate),
              options.extent,
              options.transform,
            ),
            heightOffset,
          ),
        });
      }
    }
  }

  if (!items.length) {
    return undefined;
  }

  const collection = new BufferPointCollection({
    primitiveCountMax: items.length,
  });
  collection.modelMatrix = options.transform.modelMatrix;

  const scratchPoint = new BufferPoint();
  for (const item of items) {
    collection.add({
      material: item.material,
      position: item.position,
    }, scratchPoint);
  }

  return {
    byteLength: collection.byteLength,
    destroy: () => collection.destroy(),
    update: frameState => collection.update(frameState),
  };
}

function createPolygonRenderable(
  options: CreateStaticRenderableOptions,
): Omit<MvtStaticRenderable, 'order'> | undefined {
  const items: MvtPolygonRenderItem[] = [];
  let totalHoles = 0;
  let totalTriangles = 0;
  let totalVertices = 0;
  const heightOffset = getLayerHeightOffset(options.layer);

  for (const feature of options.features) {
    if (feature.geometryType !== 'Polygon') {
      continue;
    }

    const displayFeature = getClippedDisplayFeature(
      feature,
      options.extent,
      options.transform,
      options.displayFeatureCache,
    );
    if (!displayFeature || displayFeature.geometryType !== 'Polygon') {
      continue;
    }

    const styleRule = resolveFillStyleRule(options.styleSet, options.layer, options.renderZoom, feature);
    if (!styleRule.visible) {
      continue;
    }

    const material = createFeatureMaterial(
      options.styleSet,
      options.layer,
      options.renderZoom,
      feature,
      options.materialCache,
    );
    if (!(material instanceof BufferPolygonMaterial)) {
      continue;
    }

    for (const polygon of displayFeature.geometry) {
      const renderItem = createPolygonRenderItem(
        polygon,
        options.extent,
        material,
        options.transform,
        styleRule.translate,
        heightOffset,
      );
      if (!renderItem) {
        continue;
      }

      items.push(renderItem);
      totalHoles += renderItem.holeCount;
      totalTriangles += renderItem.triangleCount;
      totalVertices += renderItem.vertexCount;
    }
  }

  if (!items.length) {
    return undefined;
  }

  const collection = new BufferPolygonCollection({
    allowPicking: false,
    holeCountMax: totalHoles,
    positionDatatype: ComponentDatatype.DOUBLE,
    primitiveCountMax: items.length,
    triangleCountMax: totalTriangles,
    vertexCountMax: totalVertices,
  });
  collection.modelMatrix = options.transform.modelMatrix;

  const scratchPolygon = new BufferPolygon();
  for (const item of items) {
    collection.add({
      holes: item.holes,
      material: item.material,
      positions: item.positions,
      triangles: item.triangles,
    }, scratchPolygon);
  }

  return {
    byteLength: collection.byteLength,
    destroy: () => collection.destroy(),
    update: frameState => collection.update(frameState),
  };
}

function createPolylineRenderable(
  options: CreateStaticRenderableOptions,
): Omit<MvtStaticRenderable, 'order'> | undefined {
  const items: MvtPolylineRenderItem[] = [];
  let totalVertices = 0;
  const tileUnitsPerPixel = getTileUnitsPerPixel(options.extent);
  const heightOffset = getLayerHeightOffset(options.layer);

  for (const feature of options.features) {
    if (feature.geometryType !== 'LineString') {
      continue;
    }

    const displayFeature = getClippedDisplayFeature(
      feature,
      options.extent,
      options.transform,
      options.displayFeatureCache,
    );
    if (!displayFeature || displayFeature.geometryType !== 'LineString') {
      continue;
    }

    const styleRule = resolveLineStyleRule(options.styleSet, options.layer, options.renderZoom, feature);
    if (!styleRule.visible) {
      continue;
    }

    const material = createFeatureMaterial(
      options.styleSet,
      options.layer,
      options.renderZoom,
      feature,
      options.materialCache,
    );
    if (!(material instanceof BufferPolylineMaterial)) {
      continue;
    }

    for (const part of displayFeature.geometry) {
      const styledPart = translateTilePoints(
        offsetPolylineInTileSpace(normalizePolylinePoints(part), options.extent, styleRule.offset),
        options.extent,
        styleRule.translate,
      );
      if (styledPart.length < 2) {
        continue;
      }

      const dashParts = splitPolylineByDashPattern(
        styledPart,
        styleRule.dashArray,
        Math.max(styleRule.outlineWidth, styleRule.width, 1),
        tileUnitsPerPixel,
      );

      for (const dashPart of dashParts) {
        const normalizedPart = normalizePolylinePoints(dashPart);
        if (normalizedPart.length < 2) {
          continue;
        }

        const positions = new Float64Array(normalizedPart.length * 3);
        normalizedPart.forEach((point, pointIndex) => {
          const localPosition = liftLocalPosition(
            projectTilePointToLocalCartesian(point, options.extent, options.transform),
            heightOffset,
          );
          const offset = pointIndex * 3;
          positions[offset] = localPosition.x;
          positions[offset + 1] = localPosition.y;
          positions[offset + 2] = localPosition.z;
        });

        items.push({
          material,
          positions,
          vertexCount: normalizedPart.length,
        });
        totalVertices += normalizedPart.length;
      }
    }
  }

  if (!items.length) {
    return undefined;
  }

  const collection = new BufferPolylineCollection({
    allowPicking: false,
    positionDatatype: ComponentDatatype.DOUBLE,
    primitiveCountMax: items.length,
    vertexCountMax: totalVertices,
  });
  collection.modelMatrix = options.transform.modelMatrix;

  const scratchPolyline = new BufferPolyline();
  for (const item of items) {
    collection.add({
      material: item.material,
      positions: item.positions,
    }, scratchPolyline);
  }

  return {
    byteLength: collection.byteLength,
    destroy: () => collection.destroy(),
    update: frameState => collection.update(frameState),
  };
}

function createPolygonRenderItem(
  polygon: MvtPolygonBucketFeature['geometry'][number],
  extent: number,
  material: BufferPolygonMaterial,
  transform: ReturnType<typeof createMvtTileTransform>,
  translate: readonly [number, number],
  heightOffset: number,
): MvtPolygonRenderItem | undefined {
  const flatTilePositions: number[] = [];
  const flatLocalPositions: number[] = [];
  const holes: number[] = [];
  let vertexCount = 0;

  polygon.forEach((ring, ringIndex) => {
    const normalizedRing = translateTilePoints(normalizeRingPoints(ring), extent, translate);
    if (normalizedRing.length < 3) {
      return;
    }

    if (ringIndex > 0) {
      holes.push(vertexCount);
    }

    vertexCount += normalizedRing.length;
    for (const point of normalizedRing) {
      flatTilePositions.push(point.x, point.y);
      const localPosition = liftLocalPosition(
        projectTilePointToLocalCartesian(point, extent, transform),
        heightOffset,
      );
      flatLocalPositions.push(localPosition.x, localPosition.y, localPosition.z);
    }
  });

  if (vertexCount < 3) {
    return undefined;
  }

  const triangles = indexDatatype.createTypedArray(vertexCount, earcut(flatTilePositions, holes, 2));
  if (!triangles.length) {
    return undefined;
  }

  const holeArray = holes.length ? new Uint32Array(holes) : undefined;
  return {
    holeCount: holeArray?.length ?? 0,
    holes: holeArray,
    material,
    positions: new Float64Array(flatLocalPositions),
    triangleCount: triangles.length / 3,
    triangles,
    vertexCount,
  };
}

function warnUnsupportedStaticLayerProperties(
  layer: MvtCompiledStyleLayer,
  warningContext: MvtWarningContext | undefined,
): void {
  if (layer.type === 'fill' && layer.paint['fill-pattern'] !== undefined) {
    warnUnsupportedLayerProperty(warningContext, layer, 'paint', 'fill-pattern');
  }
  if (layer.type === 'line') {
    if (layer.paint['line-pattern'] !== undefined) {
      warnUnsupportedLayerProperty(warningContext, layer, 'paint', 'line-pattern');
    }
    if (layer.paint['line-gradient'] !== undefined) {
      warnUnsupportedLayerProperty(warningContext, layer, 'paint', 'line-gradient');
    }
  }
}
