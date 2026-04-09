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
  fills?: FillTileHandle;
  key: string;
  lines?: LineTileHandle;
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

  return {
    byteLength: (circles?.byteLength ?? 0)
      + (lines?.byteLength ?? 0)
      + (fills?.byteLength ?? 0),
    circles,
    fills,
    key: featureTile.key,
    lines,
  };
}

export function createEmptyRenderedTileHandle(key: string): RenderedTileHandle {
  return {
    byteLength: 0,
    key,
  };
}

export function mountRenderedTileHandle(
  root: PrimitiveCollection,
  handle: RenderedTileHandle,
) {
  mountRenderedCollections(root, handle.circles?.collections);
  mountRenderedCollections(root, handle.lines?.collections);
  mountRenderedCollections(root, handle.fills?.collections);
}

export function setRenderedTileVisibility(
  handle: RenderedTileHandle,
  visible: boolean,
) {
  setRenderedCollectionsVisibility(handle.circles?.collections, visible);
  setRenderedCollectionsVisibility(handle.lines?.collections, visible);
  setRenderedCollectionsVisibility(handle.fills?.collections, visible);
}

export function destroyRenderedTileHandle(
  root: PrimitiveCollection,
  handle: RenderedTileHandle,
) {
  destroyRenderedCollections(root, handle.circles?.collections);
  destroyRenderedCollections(root, handle.lines?.collections);
  destroyRenderedCollections(root, handle.fills?.collections);
}

function mountRenderedCollections(
  root: PrimitiveCollection,
  collections: ReadonlyArray<MountedCollectionEntry> | undefined,
) {
  if (!collections) {
    return;
  }

  for (const entry of collections) {
    root.add(entry.collection);
  }
}

function setRenderedCollectionsVisibility(
  collections: ReadonlyArray<MountedCollectionEntry> | undefined,
  visible: boolean,
) {
  if (!collections) {
    return;
  }

  for (const entry of collections) {
    entry.collection.show = visible;
  }
}

function destroyRenderedCollections(
  root: PrimitiveCollection,
  collections: ReadonlyArray<MountedCollectionEntry> | undefined,
) {
  if (!collections) {
    return;
  }

  for (const entry of collections) {
    // 类型声明里没有承诺 remove 后自动释放资源，因此这里显式 destroy，
    // 避免 collection 从场景树摘除后仍然持有 GPU 资源。
    if (root.contains(entry.collection)) {
      root.remove(entry.collection);
    }

    entry.collection.destroy();
  }
}
