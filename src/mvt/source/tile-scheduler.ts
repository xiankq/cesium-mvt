import type { Camera, Rectangle, WebMercatorTilingScheme } from 'cesium';
import type { TileCoordinate } from './tile-request';
import type { TileAvailability } from './tile-selection';
import type { SourceConstraints } from './tile-visibility';
import { resolveTileSelection } from './tile-selection';
import { collectSceneViewTileSelection } from './view-state';

export interface TileSchedulerOptions {
  maximumLevel?: number;
  minimumLevel: number;
  rectangle: Rectangle;
  tileWidth: number;
  tilingScheme: WebMercatorTilingScheme;
}

export interface ScheduleResult {
  coordinates: TileCoordinate[];
  key?: string;
}

export interface SourceTileSelection {
  readyCoordinates: TileCoordinate[];
  emptyCoordinates: TileCoordinate[];
  fallbackCoordinates: TileCoordinate[];
  requestCoordinates: TileCoordinate[];
}

export type GetAvailability = (
  sourceId: string,
  level: number,
  x: number,
  y: number,
) => TileAvailability;

export class TileScheduler {
  private readonly maximumLevel: number | undefined;
  private readonly minimumLevel: number;
  private readonly rectangle: Rectangle;
  private readonly tileWidth: number;
  private readonly tilingScheme: WebMercatorTilingScheme;
  private lastViewSelectionKey?: string;

  constructor(options: TileSchedulerOptions) {
    this.maximumLevel = options.maximumLevel;
    this.minimumLevel = options.minimumLevel;
    this.rectangle = options.rectangle;
    this.tileWidth = options.tileWidth;
    this.tilingScheme = options.tilingScheme;
  }

  schedule(
    camera: Camera,
    viewportWidth: number,
  ): ScheduleResult | null {
    const selection = collectSceneViewTileSelection({
      camera,
      maximumLevel: this.maximumLevel,
      minimumLevel: this.minimumLevel,
      rectangle: this.rectangle,
      tileWidth: this.tileWidth,
      tilingScheme: this.tilingScheme,
      viewportWidth,
    });

    return selection ?? null;
  }

  resolveSourceTiles(
    coordinates: readonly TileCoordinate[],
    sourceId: string,
    getAvailability: GetAvailability,
    constraints: SourceConstraints,
  ): SourceTileSelection {
    const selection = resolveTileSelection({
      coordinates,
      getAvailability: coord =>
        getAvailability(sourceId, coord.level, coord.x, coord.y),
      maximumLevel: constraints.maxZoom,
      minimumLevel: constraints.minZoom ?? this.minimumLevel,
    });

    return {
      ...selection,
      requestCoordinates: sortRequestCoordinates(selection.requestCoordinates),
    };
  }

  shouldUpdate(tileSelection: ScheduleResult | null): boolean {
    if (!tileSelection && this.lastViewSelectionKey !== undefined) {
      return true;
    }

    if (tileSelection && this.lastViewSelectionKey === undefined) {
      return true;
    }

    if (!tileSelection && this.lastViewSelectionKey === undefined) {
      return true;
    }

    return tileSelection?.key !== this.lastViewSelectionKey;
  }

  commit(tileSelection: ScheduleResult | null): void {
    this.lastViewSelectionKey = tileSelection?.key;
  }

  invalidate(): void {
    this.lastViewSelectionKey = undefined;
  }
}

function sortRequestCoordinates(
  coordinates: readonly TileCoordinate[],
): TileCoordinate[] {
  if (coordinates.length < 2) {
    return [...coordinates];
  }

  const firstCoordinate = coordinates[0]!;
  let minX = firstCoordinate.x;
  let maxX = firstCoordinate.x;
  let minY = firstCoordinate.y;
  let maxY = firstCoordinate.y;

  for (let index = 1; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index]!;
    minX = Math.min(minX, coordinate.x);
    maxX = Math.max(maxX, coordinate.x);
    minY = Math.min(minY, coordinate.y);
    maxY = Math.max(maxY, coordinate.y);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return [...coordinates].sort((left, right) => {
    const leftDistance = Math.abs(left.x - centerX) + Math.abs(left.y - centerY);
    const rightDistance = Math.abs(right.x - centerX) + Math.abs(right.y - centerY);

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    if (left.level !== right.level) {
      return right.level - left.level;
    }

    if (left.y !== right.y) {
      return left.y - right.y;
    }

    return left.x - right.x;
  });
}
