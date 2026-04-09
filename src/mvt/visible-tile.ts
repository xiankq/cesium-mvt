import type { Scene } from '@cesium/engine';
import type { TileCoordinate } from './types';
import { createTileKey } from './tile/tile-key';

interface CesiumPrivateScene {
  globe?: {
    _surface?: {
      tileProvider?: {
        _tilesToRenderByTextureCount?: readonly (readonly CesiumGlobeTile[] | undefined)[];
      };
    };
  };
}

interface CesiumGlobeTile {
  data?: {
    imagery?: readonly CesiumTileImagery[];
  };
}

interface CesiumImageryLayerLike {
  imageryProvider?: object;
}

interface CesiumImageryLike {
  imageryLayer?: CesiumImageryLayerLike;
  level?: number;
  state?: number;
  x?: number;
  y?: number;
}

interface CesiumTileImagery {
  loadingImagery?: CesiumImageryLike;
  readyImagery?: CesiumImageryLike;
}

export interface VisibleTileCollectionResult {
  available: boolean;
  coordinates: TileCoordinate[];
}

const cesiumImageryPlaceholderState = 7;

export function collectVisibleProviderTileCoordinates(
  scene: Scene,
  provider: object,
): VisibleTileCollectionResult {
  const tileSets = getCesiumTilesToRender(scene);
  if (!tileSets) {
    return {
      available: false,
      coordinates: [],
    };
  }

  const coordinateMap = new Map<string, TileCoordinate>();
  for (const tileSet of tileSets) {
    if (!Array.isArray(tileSet)) {
      continue;
    }

    for (const globeTile of tileSet) {
      appendTileImageryCoordinates(globeTile, provider, coordinateMap);
    }
  }

  return {
    available: true,
    coordinates: [...coordinateMap.values()].sort(compareTileCoordinate),
  };
}

function appendTileImageryCoordinates(
  globeTile: CesiumGlobeTile | undefined,
  provider: object,
  coordinateMap: Map<string, TileCoordinate>,
): void {
  const tileImageryList = globeTile?.data?.imagery;
  if (!Array.isArray(tileImageryList)) {
    return;
  }

  for (const tileImagery of tileImageryList) {
    appendImageryCoordinate(tileImagery.readyImagery, provider, coordinateMap);
    appendImageryCoordinate(tileImagery.loadingImagery, provider, coordinateMap);
  }
}

function appendImageryCoordinate(
  imagery: CesiumImageryLike | undefined,
  provider: object,
  coordinateMap: Map<string, TileCoordinate>,
): void {
  if (!imagery || imagery.state === cesiumImageryPlaceholderState) {
    return;
  }
  if (imagery.imageryLayer?.imageryProvider !== provider) {
    return;
  }
  if (
    typeof imagery.x !== 'number'
    || typeof imagery.y !== 'number'
    || typeof imagery.level !== 'number'
    || !Number.isInteger(imagery.x)
    || !Number.isInteger(imagery.y)
    || !Number.isInteger(imagery.level)
  ) {
    return;
  }

  const x = imagery.x;
  const y = imagery.y;
  const z = imagery.level;
  const coordinate = {
    x,
    y,
    z,
  };
  coordinateMap.set(createTileKey(coordinate), coordinate);
}

function compareTileCoordinate(left: TileCoordinate, right: TileCoordinate): number {
  if (right.z !== left.z) {
    return right.z - left.z;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.x - right.x;
}

function getCesiumTilesToRender(
  scene: Scene,
): readonly (readonly CesiumGlobeTile[] | undefined)[] | undefined {
  const privateScene = scene as Scene & CesiumPrivateScene;
  return privateScene.globe?._surface?.tileProvider?._tilesToRenderByTextureCount;
}
