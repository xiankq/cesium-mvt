import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  BufferPointCollection,
  BufferPolygonCollection,
  BufferPolylineCollection,
  PrimitiveCollection,
} from 'cesium';
import type { ParsedTileResult } from '../bucket';
import type { FeatureStateResolver } from '../style/feature-state-store';
import type { BucketCircleTileHandle } from './backend/bucket-circle-backend';
import type { BucketFillTileHandle } from './backend/bucket-fill-backend';
import type { BucketLineTileHandle } from './backend/bucket-line-backend';
import { createBucketCircleTileHandle } from './backend/bucket-circle-backend';
import { createBucketFillTileHandle } from './backend/bucket-fill-backend';
import { createBucketLineTileHandle } from './backend/bucket-line-backend';

type MountedCollection
  = | BufferPointCollection
    | BufferPolygonCollection
    | BufferPolylineCollection;

interface MountedCollectionEntry {
  collection: MountedCollection;
}

export interface BucketRenderedTileHandle {
  byteLength: number;
  circles?: BucketCircleTileHandle;
  collections: MountedCollectionEntry[];
  fills?: BucketFillTileHandle;
  key: string;
  lines?: BucketLineTileHandle;
  visible: boolean;
}

export interface CreateBucketRenderedTileHandleOptions {
  bucketTile: ParsedTileResult;
  featureStateResolver?: FeatureStateResolver;
  style: StyleSpecification;
}

export function createBucketRenderedTileHandle({
  bucketTile,
  featureStateResolver,
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
    style,
  });

  const collections = createOrderedCollectionEntries({
    circles,
    fills,
    lines,
    style,
  });
  const byteLength
    = (circles?.byteLength ?? 0)
      + (lines?.byteLength ?? 0)
      + (fills?.byteLength ?? 0);

  return {
    byteLength,
    circles,
    collections,
    fills,
    key: bucketTile.key,
    lines,
    visible: byteLength > 0,
  };
}

export function createEmptyBucketRenderedTileHandle(
  key: string,
): BucketRenderedTileHandle {
  return {
    byteLength: 0,
    collections: [],
    key,
    visible: false,
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
  lines,
  style,
}: {
  circles: BucketCircleTileHandle | undefined;
  fills: BucketFillTileHandle | undefined;
  lines: BucketLineTileHandle | undefined;
  style: StyleSpecification;
}): MountedCollectionEntry[] {
  const layerOrder = new Map(
    style.layers.map((layer, index) => [layer.id, index]),
  );
  const entries = [
    ...(circles?.collections ?? []),
    ...(lines?.collections ?? []),
    ...(fills?.collections ?? []),
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
  for (const entry of collections) {
    if (root.contains(entry.collection)) {
      root.remove(entry.collection);
    }

    entry.collection.destroy();
  }
}
