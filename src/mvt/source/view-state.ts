import type {
  Ellipsoid,
  Rectangle as RectangleType,
  WebMercatorTilingScheme,
} from 'cesium';
import type { TileCoordinate } from './tile-request';
import {
  Cartographic,
  Rectangle,
} from 'cesium';

export interface EstimateViewTileLevelOptions {
  maximumLevel?: number;
  minimumLevel: number;
  tileWidth: number;
  tilingScheme: WebMercatorTilingScheme;
  viewRectangle: Rectangle;
  viewportWidth: number;
}

export interface CollectCoveringTileCoordinatesOptions {
  level: number;
  rectangle: Rectangle;
  tilingScheme: WebMercatorTilingScheme;
}

export interface CollectSceneViewTileCoordinatesOptions {
  camera?: {
    computeViewRectangle: (
      ellipsoid?: Ellipsoid,
      result?: RectangleType,
    ) => Rectangle | undefined;
  };
  maximumLevel?: number;
  minimumLevel: number;
  rectangle?: Rectangle;
  tileWidth: number;
  tilingScheme: WebMercatorTilingScheme;
  viewportWidth: number;
}

export interface SceneViewTileSelection {
  coordinates: TileCoordinate[];
  key: string;
  level: number;
  rectangle: Rectangle;
}

const TILE_EDGE_EPSILON = 1e-9;

export function estimateViewTileLevel({
  maximumLevel,
  minimumLevel,
  tileWidth,
  tilingScheme,
  viewRectangle,
  viewportWidth,
}: EstimateViewTileLevelOptions) {
  const clampedViewportWidth = Math.max(1, viewportWidth);
  const viewWidth = Math.max(TILE_EDGE_EPSILON, viewRectangle.width);
  const levelZeroTiles = tilingScheme.getNumberOfXTilesAtLevel(0);
  const approximateLevel = Math.floor(Math.log2(
    (clampedViewportWidth * tilingScheme.rectangle.width)
    / (viewWidth * tileWidth * levelZeroTiles),
  ));

  return clampLevel(
    Number.isFinite(approximateLevel) ? approximateLevel : minimumLevel,
    minimumLevel,
    maximumLevel,
  );
}

export function collectCoveringTileCoordinates({
  level,
  rectangle,
  tilingScheme,
}: CollectCoveringTileCoordinatesOptions): TileCoordinate[] {
  const tileCoordinates: TileCoordinate[] = [];
  const seenKeys = new Set<string>();

  for (const rectanglePart of splitRectangleOnAntimeridian(rectangle)) {
    const clampedRectangle = Rectangle.intersection(
      rectanglePart,
      tilingScheme.rectangle,
      new Rectangle(),
    );
    if (!clampedRectangle) {
      continue;
    }

    const northwest = tilingScheme.positionToTileXY(
      new Cartographic(clampedRectangle.west, clampedRectangle.north),
      level,
    );
    const southeast = tilingScheme.positionToTileXY(
      new Cartographic(
        nudgeEastInsideRectangle(clampedRectangle),
        nudgeSouthInsideRectangle(clampedRectangle),
      ),
      level,
    );
    if (!northwest || !southeast) {
      continue;
    }

    const minX = Math.max(0, Math.min(northwest.x, southeast.x));
    const maxX = Math.min(
      tilingScheme.getNumberOfXTilesAtLevel(level) - 1,
      Math.max(northwest.x, southeast.x),
    );
    const minY = Math.max(0, Math.min(northwest.y, southeast.y));
    const maxY = Math.min(
      tilingScheme.getNumberOfYTilesAtLevel(level) - 1,
      Math.max(northwest.y, southeast.y),
    );

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${level}/${x}/${y}`;
        if (seenKeys.has(key)) {
          continue;
        }

        seenKeys.add(key);
        tileCoordinates.push({
          level,
          x,
          y,
        });
      }
    }
  }

  return tileCoordinates;
}

export function collectSceneViewTileSelection({
  camera,
  maximumLevel,
  minimumLevel,
  rectangle,
  tileWidth,
  tilingScheme,
  viewportWidth,
}: CollectSceneViewTileCoordinatesOptions): SceneViewTileSelection | undefined {
  const viewRectangle = camera?.computeViewRectangle?.(tilingScheme.ellipsoid);
  if (!viewRectangle) {
    return undefined;
  }

  const coverageRectangle = rectangle
    ? Rectangle.intersection(viewRectangle, rectangle, new Rectangle())
    : Rectangle.clone(viewRectangle);
  if (!coverageRectangle) {
    return undefined;
  }

  const level = estimateViewTileLevel({
    maximumLevel,
    minimumLevel,
    tileWidth,
    tilingScheme,
    viewRectangle: coverageRectangle,
    viewportWidth,
  });
  const coordinates = collectCoveringTileCoordinates({
    level,
    rectangle: coverageRectangle,
    tilingScheme,
  });
  if (coordinates.length === 0) {
    return undefined;
  }

  return {
    coordinates,
    key: createSceneViewSelectionKey(coverageRectangle, level, viewportWidth),
    level,
    rectangle: coverageRectangle,
  };
}

function createSceneViewSelectionKey(
  rectangle: Rectangle,
  level: number,
  viewportWidth: number,
) {
  return [
    level,
    Math.max(1, Math.round(viewportWidth)),
    rectangle.west.toFixed(6),
    rectangle.south.toFixed(6),
    rectangle.east.toFixed(6),
    rectangle.north.toFixed(6),
  ].join('/');
}

function splitRectangleOnAntimeridian(rectangle: Rectangle) {
  if (rectangle.east >= rectangle.west) {
    return [rectangle];
  }

  return [
    new Rectangle(rectangle.west, rectangle.south, Math.PI, rectangle.north),
    new Rectangle(-Math.PI, rectangle.south, rectangle.east, rectangle.north),
  ];
}

function nudgeEastInsideRectangle(rectangle: Rectangle) {
  return Math.max(
    rectangle.west,
    rectangle.east - TILE_EDGE_EPSILON,
  );
}

function nudgeSouthInsideRectangle(rectangle: Rectangle) {
  return Math.min(
    rectangle.north,
    rectangle.south + TILE_EDGE_EPSILON,
  );
}

function clampLevel(
  level: number,
  minimumLevel: number,
  maximumLevel: number | undefined,
) {
  const minimumClampedLevel = Math.max(minimumLevel, level);
  if (maximumLevel === undefined) {
    return minimumClampedLevel;
  }

  return Math.min(maximumLevel, minimumClampedLevel);
}
