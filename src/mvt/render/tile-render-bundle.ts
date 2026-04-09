import type { Cartesian3, TilingScheme } from '@cesium/engine';
import type { DisplayFeatureCache } from '../mesh/display-feature';
import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer, MeshIndexArray, ParsedTileData, PolygonBucketFeature, TileCoordinate } from '../types';
import type { WarningContext } from '../warning-context';
import type { FeatureMaterialCache } from './style-material';
import type { TileRenderableLike } from './symbol-renderable';
import { BufferPoint, BufferPointCollection, BufferPointMaterial, BufferPolygon, BufferPolygonCollection, BufferPolygonMaterial, BufferPolyline, BufferPolylineCollection, BufferPolylineMaterial, ComponentDatatype, IndexDatatype } from '@cesium/engine';
import earcut from 'earcut';
import { getClippedDisplayFeature } from '../mesh/display-feature';
import { normalizePolylinePoints, normalizeRingPoints } from '../mesh/geometry-normalize';
import { warnUnsupportedLayerProperty } from '../warning-context';
import { sortBucketFeaturesForLayer } from './feature-sort';
import { getLayerHeightOffset, liftLocalPosition } from './layer-height';
import { splitPolylineByDashPattern } from './line-dash';
import { getTileUnitsPerPixel, offsetPolylineInTileSpace, translateTilePoint, translateTilePoints } from './style-geometry';
import { createFeatureMaterial } from './style-material';
import { resolveCircleStyleRule, resolveFillStyleRule, resolveLineStyleRule } from './style-rule';
import { SymbolCollisionIndex } from './symbol-collision';
import { createSymbolRenderable } from './symbol-renderable';
import { createTileTransform, projectTilePointToLocalCartesian } from './tile-transform';

type CesiumIndexDatatype = typeof IndexDatatype & {
  createTypedArray: (numberOfVertices: number, indicesLengthOrArray: number[] | number) => MeshIndexArray;
};

interface PointRenderItem {
  material: BufferPointMaterial;
  position: Cartesian3;
}

interface PolygonRenderItem {
  holes?: Uint32Array;
  holeCount: number;
  material: BufferPolygonMaterial;
  positions: Float64Array;
  triangleCount: number;
  triangles: MeshIndexArray;
  vertexCount: number;
}

interface PolylineRenderItem {
  material: BufferPolylineMaterial;
  positions: Float64Array;
  vertexCount: number;
}

interface StaticRenderable {
  byteLength: number;
  destroy: () => void;
  order: number;
  update: (frameState: unknown) => void;
}

interface SymbolEntry {
  extent: number;
  features: readonly BucketFeature[];
  layer: CompiledStyleLayer;
}

export interface TileRenderBundle {
  readonly byteLength: number;
  destroy: () => void;
  isDestroyed: () => boolean;
  update: (
    frameState: unknown,
    renderZoom?: number,
    symbolCollisionIndex?: SymbolCollisionIndex,
  ) => void;
}

export interface TileRenderBundleOptions {
  coordinate: TileCoordinate;
  displayFeatureCache?: DisplayFeatureCache;
  parsedTileData: ParsedTileData;
  sourceCoordinate?: TileCoordinate;
  styleSet: StyleSet;
  tilingScheme: TilingScheme;
  warningContext?: WarningContext;
}

const indexDatatype = IndexDatatype as CesiumIndexDatatype;

export function createTileRenderBundle(options: TileRenderBundleOptions): TileRenderBundle {
  const transform = createTileTransform(
    options.tilingScheme,
    options.coordinate,
    options.sourceCoordinate ?? options.coordinate,
  );
  const materialCache: FeatureMaterialCache = new Map();
  let destroyed = false;
  let byteLength = 0;
  let lastBuiltZoom: number | undefined;
  let staticByteLength = 0;
  let symbolByteLength = 0;
  let staticRenderables: StaticRenderable[] = [];
  let symbolEntries: SymbolEntry[] = [];
  let symbolRenderables: TileRenderableLike[] = [];

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
      symbolCollisionIndex = new SymbolCollisionIndex(),
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

    const nextStaticRenderables: StaticRenderable[] = [];
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
    rebuildSymbolRenderables(new SymbolCollisionIndex(), renderZoom);
  }

  function rebuildSymbolRenderables(
    symbolCollisionIndex: SymbolCollisionIndex,
    renderZoom: number,
  ): void {
    destroySymbolRenderables();

    const nextSymbolRenderables: TileRenderableLike[] = [];
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
  displayFeatureCache?: DisplayFeatureCache;
  extent: number;
  features: readonly BucketFeature[];
  layer: CompiledStyleLayer;
  materialCache: FeatureMaterialCache;
  renderZoom: number;
  styleSet: StyleSet;
  transform: ReturnType<typeof createTileTransform>;
  warningContext?: WarningContext;
}

function createStaticRenderable(
  options: CreateStaticRenderableOptions,
): Omit<StaticRenderable, 'order'> | undefined {
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
): Omit<StaticRenderable, 'order'> | undefined {
  const items: PointRenderItem[] = [];
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
): Omit<StaticRenderable, 'order'> | undefined {
  const items: PolygonRenderItem[] = [];
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
): Omit<StaticRenderable, 'order'> | undefined {
  const items: PolylineRenderItem[] = [];
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
  polygon: PolygonBucketFeature['geometry'][number],
  extent: number,
  material: BufferPolygonMaterial,
  transform: ReturnType<typeof createTileTransform>,
  translate: readonly [number, number],
  heightOffset: number,
): PolygonRenderItem | undefined {
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
  layer: CompiledStyleLayer,
  warningContext: WarningContext | undefined,
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
