import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  BillboardCollection,
  BufferPointCollection,
  BufferPolygonCollection,
  BufferPolylineCollection,
  LabelCollection,
  PolylineCollection,
  Primitive,
} from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { StyleIndex } from '../style/style-manager';
import type { BucketCircleTileHandle } from './backend/bucket-circle-backend';
import type { BucketFillTileHandle } from './backend/bucket-fill-backend';
import type { BucketFillExtrusionTileHandle } from './backend/bucket-fill-extrusion-backend';
import type { BucketLineTileHandle } from './backend/bucket-line-backend';
import type {
  BucketSymbolTileHandle,
  CreateBucketSymbolTileHandleOptions,
} from './backend/bucket-symbol-types';
import { PrimitiveCollection } from 'cesium';
import { createBucketCircleTileHandle } from './backend/bucket-circle-backend';
import { createBucketFillTileHandle } from './backend/bucket-fill-backend';
import { createBucketFillExtrusionTileHandle } from './backend/bucket-fill-extrusion-backend';
import { createBucketLineTileHandle } from './backend/bucket-line-backend';

type MountedCollection
  = | BufferPointCollection
    | BufferPolygonCollection
    | BufferPolylineCollection
    | BillboardCollection
    | LabelCollection
    | PolylineCollection
    | Primitive;

interface MountedCollectionEntry {
  collection: MountedCollection;
}

export interface BucketRenderedTileHandle {
  byteLength: number;
  circles?: BucketCircleTileHandle;
  collections: MountedCollectionEntry[];
  fills?: BucketFillTileHandle;
  fillExtrusions?: BucketFillExtrusionTileHandle;
  key: string;
  lines?: BucketLineTileHandle;
  sourceLayers: string[];
  symbolRequest?: CreateBucketSymbolTileHandleOptions;
  symbolPriority?: number;
  symbols?: BucketSymbolTileHandle;
  tileCollection: PrimitiveCollection;
  visible: boolean;
}

export interface CreateBucketRenderedTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  symbolPriority?: number;
  styleEpoch?: number;
  style: StyleSpecification;
  styleIndex?: StyleIndex;
  tileWidth?: number;
}

export function createBucketRenderedTileHandle({
  bucketTile,
  featureStateResolver,
  tileWidth,
  styleIndex,
  symbolPriority,
  styleEpoch,
  style,
}: CreateBucketRenderedTileHandleOptions): BucketRenderedTileHandle {
  const circles = createBucketCircleTileHandle({
    bucketTile,
    featureStateResolver,
    style,
    styleIndex,
  });
  const lines = createBucketLineTileHandle({
    bucketTile,
    featureStateResolver,
    style,
    styleIndex,
  });
  const fills = createBucketFillTileHandle({
    bucketTile,
    featureStateResolver,
    tileWidth,
    style,
    styleIndex,
  });
  const fillExtrusions = createBucketFillExtrusionTileHandle({
    bucketTile,
    featureStateResolver,
    tileWidth,
    style,
    styleIndex,
  });

  const collections = createOrderedCollectionEntries({
    circles,
    fills,
    fillExtrusions,
    lines,
    style,
    styleIndex,
  });
  const byteLength
    = (circles?.byteLength ?? 0)
      + (lines?.byteLength ?? 0)
      + (fills?.byteLength ?? 0)
      + (fillExtrusions?.byteLength ?? 0)
      + getSymbolBucketByteLength(bucketTile);
  const tileCollection = new PrimitiveCollection();

  return {
    byteLength,
    circles,
    collections,
    fills,
    fillExtrusions,
    key: bucketTile.key,
    lines,
    sourceLayers: collectSourceLayers(bucketTile),
    symbolRequest: hasSymbolBuckets(bucketTile)
      ? {
          bucketTile,
          featureStateResolver,
          priority: symbolPriority,
          styleEpoch,
          style,
          styleIndex,
          tileWidth,
        }
      : undefined,
    symbolPriority,
    tileCollection,
    visible: byteLength > 0,
  };
}

export function mountBucketRenderedTileHandle(
  root: PrimitiveCollection,
  handle: BucketRenderedTileHandle,
) {
  mountRenderedCollections(handle.tileCollection, handle.collections);
  root.add(handle.tileCollection);
  setRenderedCollectionsVisibility(handle.collections, handle.visible);
  handle.tileCollection.show = handle.visible;
}

export function setBucketRenderedTileVisibility(
  handle: BucketRenderedTileHandle,
  visible: boolean,
): boolean {
  if (handle.visible === visible) {
    return false;
  }

  setRenderedCollectionsVisibility(handle.collections, visible);
  handle.tileCollection.show = visible;
  handle.visible = visible;
  return true;
}

export function attachBucketRenderedTileSymbols(
  handle: BucketRenderedTileHandle,
  symbols: BucketSymbolTileHandle,
): boolean {
  if (handle.symbols) {
    return false;
  }

  if (handle.tileCollection.isDestroyed()) {
    return false;
  }

  handle.symbols = symbols;

  const symbolCollections = symbols.collections.map(entry => ({
    collection: entry.collection,
  }));
  handle.collections.push(...symbolCollections);
  mountRenderedCollections(handle.tileCollection, symbolCollections);
  setRenderedCollectionsVisibility(symbolCollections, handle.visible);
  return true;
}

export function destroyBucketRenderedTileHandle(
  root: PrimitiveCollection,
  handle: BucketRenderedTileHandle,
) {
  destroyRenderedCollection(root, handle.tileCollection);
  handle.symbolRequest = undefined;
  handle.symbolPriority = undefined;
  handle.symbols = undefined;
  handle.visible = false;
}

function createOrderedCollectionEntries({
  circles,
  fills,
  fillExtrusions,
  lines,
  style,
  styleIndex,
}: {
  circles: BucketCircleTileHandle | undefined;
  fills: BucketFillTileHandle | undefined;
  fillExtrusions: BucketFillExtrusionTileHandle | undefined;
  lines: BucketLineTileHandle | undefined;
  style: StyleSpecification;
  styleIndex?: StyleIndex;
}): MountedCollectionEntry[] {
  const layerOrder = styleIndex?.layerOrderById ?? new Map(
    style.layers.map((layer, index) => [layer.id, index]),
  );
  const entries = [
    ...(circles?.collections ?? []),
    ...(lines?.collections ?? []),
    ...(fills?.collections ?? []),
    ...(fillExtrusions?.collections ?? []),
  ].map((entry, index) => ({
    collection: entry.collection,
    index,
    order: layerOrder.get(entry.layerId) ?? Number.MAX_SAFE_INTEGER,
  }));

  entries.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.index - right.index;
  });

  return entries.map(({ collection }) => ({
    collection,
  }));
}

function hasSymbolBuckets(bucketTile: ParsedTileResult): boolean {
  return bucketTile.buckets.some(bucket => bucket.type === 'symbol');
}

function getSymbolBucketByteLength(bucketTile: ParsedTileResult): number {
  let byteLength = 0;

  for (const bucket of bucketTile.buckets) {
    if (bucket.type !== 'symbol') {
      continue;
    }

    byteLength += bucket.stats.byteLength;
  }

  return byteLength;
}

function mountRenderedCollections(
  root: PrimitiveCollection,
  collections: ReadonlyArray<MountedCollectionEntry>,
): void {
  for (const entry of collections) {
    root.add(entry.collection);
  }
}

function setRenderedCollectionsVisibility(
  collections: ReadonlyArray<MountedCollectionEntry>,
  visible: boolean,
) {
  for (const entry of collections) {
    entry.collection.show = visible;
  }
}

function destroyRenderedCollection(
  root: PrimitiveCollection,
  collection: PrimitiveCollection,
): void {
  const rootDestroyed = root.isDestroyed();
  const wasRemoved = rootDestroyed ? false : root.remove(collection);
  const shouldDestroy = rootDestroyed || !wasRemoved || !root.destroyPrimitives;

  if (shouldDestroy && !collection.isDestroyed()) {
    collection.destroy();
  }
}

function collectSourceLayers(bucketTile: ParsedTileResult): string[] {
  const sourceLayers: string[] = [];

  for (const bucket of bucketTile.buckets) {
    const sourceLayer = bucket.sourceLayer;
    if (typeof sourceLayer !== 'string') {
      continue;
    }

    if (sourceLayers.includes(sourceLayer)) {
      continue;
    }

    sourceLayers.push(sourceLayer);
  }

  return sourceLayers;
}
