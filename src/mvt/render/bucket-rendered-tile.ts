import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  BillboardCollection,
  BufferPointCollection,
  BufferPolygonCollection,
  BufferPolylineCollection,
  LabelCollection,
  PolylineCollection,
  Primitive,
  PrimitiveCollection,
} from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { BucketCircleTileHandle } from './backend/bucket-circle-backend';
import type { BucketFillTileHandle } from './backend/bucket-fill-backend';
import type { BucketFillExtrusionTileHandle } from './backend/bucket-fill-extrusion-backend';
import type { BucketLineTileHandle } from './backend/bucket-line-backend';
import type { BucketSymbolTileHandle } from './backend/bucket-symbol-types';
import { createBucketCircleTileHandle } from './backend/bucket-circle-backend';
import { createBucketFillTileHandle } from './backend/bucket-fill-backend';
import { createBucketFillExtrusionTileHandle } from './backend/bucket-fill-extrusion-backend';
import { createBucketLineTileHandle } from './backend/bucket-line-backend';
import { createBucketSymbolTileHandle } from './backend/bucket-symbol-backend';

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
  symbols?: BucketSymbolTileHandle;
  visible: boolean;
}

export interface CreateBucketRenderedTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  style: StyleSpecification;
  tileWidth?: number;
}

export function createBucketRenderedTileHandle({
  bucketTile,
  featureStateResolver,
  tileWidth,
  style,
}: CreateBucketRenderedTileHandleOptions): BucketRenderedTileHandle {
  const circles = createBucketCircleTileHandle({
    bucketTile,
    featureStateResolver,
    style,
  });
  const lines = createBucketLineTileHandle({
    bucketTile,
    featureStateResolver,
    style,
  });
  const fills = createBucketFillTileHandle({
    bucketTile,
    featureStateResolver,
    tileWidth,
    style,
  });
  const fillExtrusions = createBucketFillExtrusionTileHandle({
    bucketTile,
    featureStateResolver,
    tileWidth,
    style,
  });
  const symbols = createBucketSymbolTileHandle({
    bucketTile,
    featureStateResolver,
    tileWidth,
    style,
  });

  const collections = createOrderedCollectionEntries({
    circles,
    fills,
    fillExtrusions,
    lines,
    style,
    symbols,
  });
  const byteLength
    = (circles?.byteLength ?? 0)
      + (lines?.byteLength ?? 0)
      + (fills?.byteLength ?? 0)
      + (fillExtrusions?.byteLength ?? 0)
      + (symbols?.byteLength ?? 0);

  return {
    byteLength,
    circles,
    collections,
    fills,
    fillExtrusions,
    key: bucketTile.key,
    lines,
    symbols,
    visible: byteLength > 0,
  };
}

export function mountBucketRenderedTileHandle(
  root: PrimitiveCollection,
  handle: BucketRenderedTileHandle,
) {
  mountRenderedCollections(root, handle.collections);
  setRenderedCollectionsVisibility(handle.collections, handle.visible);
}

export function setBucketRenderedTileVisibility(
  handle: BucketRenderedTileHandle,
  visible: boolean,
): boolean {
  if (handle.visible === visible) {
    return false;
  }

  setRenderedCollectionsVisibility(handle.collections, visible);
  handle.visible = visible;
  return true;
}

export function destroyBucketRenderedTileHandle(
  root: PrimitiveCollection,
  handle: BucketRenderedTileHandle,
) {
  destroyRenderedCollections(root, handle.collections);
  handle.visible = false;
}

function createOrderedCollectionEntries({
  circles,
  fills,
  fillExtrusions,
  lines,
  style,
  symbols,
}: {
  circles: BucketCircleTileHandle | undefined;
  fills: BucketFillTileHandle | undefined;
  fillExtrusions: BucketFillExtrusionTileHandle | undefined;
  lines: BucketLineTileHandle | undefined;
  style: StyleSpecification;
  symbols: BucketSymbolTileHandle | undefined;
}): MountedCollectionEntry[] {
  const layerOrder = new Map(
    style.layers.map((layer, index) => [layer.id, index]),
  );
  const entries = [
    ...(circles?.collections ?? []),
    ...(lines?.collections ?? []),
    ...(fills?.collections ?? []),
    ...(fillExtrusions?.collections ?? []),
    ...(symbols?.collections ?? []),
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

function destroyRenderedCollections(
  root: PrimitiveCollection,
  collections: ReadonlyArray<MountedCollectionEntry>,
): void {
  const rootDestroyed = root.isDestroyed();
  for (const entry of collections) {
    const wasRemoved = rootDestroyed ? false : root.remove(entry.collection);
    const shouldDestroy = rootDestroyed || !wasRemoved || !root.destroyPrimitives;

    if (shouldDestroy && !entry.collection.isDestroyed()) {
      entry.collection.destroy();
    }
  }
}
