import type { Camera, Rectangle, WebMercatorTilingScheme } from 'cesium';
import type { TileCoordinate } from './tile-request';
import type { TileAvailability } from './tile-selection';
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

export interface SourceConstraints {
  maxZoom?: number;
  minZoom?: number;
}

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
    return resolveTileSelection({
      coordinates,
      getAvailability: coord =>
        getAvailability(sourceId, coord.level, coord.x, coord.y),
      maximumLevel: constraints.maxZoom,
      minimumLevel: constraints.minZoom ?? this.minimumLevel,
    });
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
