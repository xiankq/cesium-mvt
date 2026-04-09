import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  BufferPointCollection,
  BufferPolygonCollection,
  BufferPolylineCollection,
  PrimitiveCollection,
  WebMercatorTilingScheme,
} from 'cesium';
import type { CircleTileHandle } from './backend/circle-backend';
import type { FillTileHandle } from './backend/fill-backend';
import type { LineTileHandle } from './backend/line-backend';
import type { FeatureTile } from './feature-tile';
import { createCircleTileHandle } from './backend/circle-backend';
import { createFillTileHandle } from './backend/fill-backend';
import { createLineTileHandle } from './backend/line-backend';

type MountedCollection = BufferPointCollection | BufferPolygonCollection | BufferPolylineCollection;

interface MountedCollectionEntry {
  collection: MountedCollection;
}

export interface RenderedTileHandle {
  byteLength: number;
  circles?: CircleTileHandle;
  collections: MountedCollectionEntry[];
  fills?: FillTileHandle;
  key: string;
  lines?: LineTileHandle;
  visible: boolean;
}

export interface CreateRenderedTileHandleOptions {
  featureTile: FeatureTile;
  level: number;
  style: StyleSpecification;
  tilingScheme?: WebMercatorTilingScheme;
  x: number;
  y: number;
}

export function createRenderedTileHandle({
  featureTile,
  level,
  style,
  tilingScheme,
  x,
  y,
}: CreateRenderedTileHandleOptions): RenderedTileHandle {
  const circles = createCircleTileHandle({
    featureTile,
    level,
    style,
    tilingScheme,
    x,
    y,
  });
  const lines = createLineTileHandle({
    featureTile,
    level,
    style,
    tilingScheme,
    x,
    y,
  });
  const fills = createFillTileHandle({
    featureTile,
    level,
    style,
    tilingScheme,
    x,
    y,
  });
  const collections = createOrderedCollectionEntries({
    circles,
    fills,
    lines,
    style,
  });
  const byteLength = (circles?.byteLength ?? 0)
    + (lines?.byteLength ?? 0)
    + (fills?.byteLength ?? 0);

  return {
    byteLength,
    circles,
    collections,
    fills,
    key: featureTile.key,
    lines,
    visible: byteLength > 0,
  };
}

export function createEmptyRenderedTileHandle(key: string): RenderedTileHandle {
  return {
    byteLength: 0,
    collections: [],
    key,
    visible: false,
  };
}

export function mountRenderedTileHandle(
  root: PrimitiveCollection,
  handle: RenderedTileHandle,
) {
  mountRenderedCollections(root, handle.collections);
}

export function setRenderedTileVisibility(
  handle: RenderedTileHandle,
  visible: boolean,
): boolean {
  if (handle.visible === visible) {
    return false;
  }

  setRenderedCollectionsVisibility(handle.collections, visible);
  handle.visible = visible;
  return true;
}

export function destroyRenderedTileHandle(
  root: PrimitiveCollection,
  handle: RenderedTileHandle,
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
  circles: CircleTileHandle | undefined;
  fills: FillTileHandle | undefined;
  lines: LineTileHandle | undefined;
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
    // 类型声明里没有承诺 remove 后自动释放资源，因此这里显式 destroy，
    // 避免 collection 从场景树摘除后仍然持有 GPU 资源。
    if (root.contains(entry.collection)) {
      root.remove(entry.collection);
    }

    entry.collection.destroy();
  }
}
