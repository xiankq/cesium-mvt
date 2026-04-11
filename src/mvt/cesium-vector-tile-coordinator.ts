import type { SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { PrimitiveCollection, Rectangle, WebMercatorTilingScheme } from 'cesium';
import type { ParsedTileResult } from './bucket';
import type { TileAvailability } from './source/tile-selection';
import { RenderManager } from './render';
import { compileRenderTile } from './render/render-tile';
import { SourceManager, TileCacheManager, TileScheduler } from './source';
import { StyleManager } from './style/style-manager';

export interface CesiumVectorTileCoordinatorOptions {
  maximumLevel?: number;
  minimumLevel: number;
  rectangle: Rectangle;
  root: PrimitiveCollection;
  tileWidth: number;
  tilingScheme: WebMercatorTilingScheme;
}

export interface FrameState {
  camera: any;
  viewportHeight: number;
  viewportWidth: number;
}

export class CesiumVectorTileCoordinator {
  private destroyed = false;
  private readonly scheduler: TileScheduler;
  private readonly cacheManager: TileCacheManager;
  private readonly renderManager: RenderManager;
  private readonly sourceManager: SourceManager;
  private readonly styleManager: StyleManager;
  private readonly tilingScheme: WebMercatorTilingScheme;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  constructor(options: CesiumVectorTileCoordinatorOptions) {
    this.tilingScheme = options.tilingScheme;

    this.scheduler = new TileScheduler({
      maximumLevel: options.maximumLevel,
      minimumLevel: options.minimumLevel,
      rectangle: options.rectangle,
      tileWidth: options.tileWidth,
      tilingScheme: options.tilingScheme,
    });

    this.cacheManager = new TileCacheManager();
    this.renderManager = new RenderManager({ root: options.root });
    this.sourceManager = new SourceManager();
    this.styleManager = new StyleManager();
  }

  update(frameState: FrameState): void {
    if (this.destroyed) {
      return;
    }

    const tileSelection = this.scheduler.schedule(
      frameState.camera,
      frameState.viewportWidth,
    );

    if (!tileSelection || !this.scheduler.shouldUpdate(tileSelection)) {
      return;
    }

    this.scheduler.commit(tileSelection);
    this.processTileSelection(tileSelection.coordinates);
  }

  updateStyle(style: StyleSpecification): void {
    if (this.destroyed) {
      return;
    }

    this.styleManager.updateStyle({ style });
    this.sourceManager.reconcileSources(style.sources as Record<string, SourceSpecification>);
    this.renderManager.updateLayerFamilies(style, this.styleManager.getLayerFamilies());
    this.scheduler.invalidate();
  }

  getStyle(): StyleSpecification | undefined {
    return this.styleManager.getStyle();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.sourceManager.destroy();
    this.cacheManager.destroy();
    this.renderManager.destroy();
  }

  private processTileSelection(coordinates: any[]): void {
    if (!this.styleManager.hasStyle()) {
      return;
    }

    const availableSourceIds = this.sourceManager.getSourceIds();

    for (const sourceId of availableSourceIds) {
      const constraints = this.sourceManager.getSourceConstraints(sourceId);
      const sourceSelection = this.scheduler.resolveSourceTiles(
        coordinates,
        sourceId,
        (sid: string, level: number, x: number, y: number) =>
          this.getTileAvailability(sid, level, x, y),
        constraints,
      );

      for (const coord of sourceSelection.readyCoordinates) {
        this.showResolvedTile(sourceId, coord.level, coord.x, coord.y);
      }

      for (const coord of sourceSelection.requestCoordinates) {
        this.requestTile(sourceId, coord.level, coord.x, coord.y);
      }
    }
  }

  private getTileAvailability(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): TileAvailability {
    const key = this.resolveRenderTileKey(sourceId, level, x, y);
    const handle = this.renderManager.getHandle(key);
    if (!handle) {
      return 'missing';
    }
    return handle.byteLength > 0 ? 'ready' : 'empty';
  }

  private showResolvedTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): void {
    const key = this.resolveRenderTileKey(sourceId, level, x, y);
    this.renderManager.show(key);
  }

  private async requestTile(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): Promise<void> {
    const key = this.resolveRenderTileKey(sourceId, level, x, y);

    if (this.cacheManager.has(key)) {
      const tile = this.cacheManager.get(key)!;
      const style = this.styleManager.getStyle();
      if (style) {
        this.renderManager.mount(key, tile, style);
      }
      return;
    }

    if (this.cacheManager.hasPending(key)) {
      return;
    }

    const style = this.styleManager.getStyle();
    if (!style) {
      return;
    }

    const renderTile = compileRenderTile({
      key: `${sourceId}/${level}/${x}/${y}`,
      layerFamilies: this.renderManager.getLayerFamilies(),
      renderOrder: this.renderManager.getRenderOrder(),
      style,
      styleEpoch: this.styleManager.getStyleEpoch(),
    });

    try {
      const tile = await this.sourceManager.requestTile(
        sourceId,
        level,
        x,
        y,
        key,
        this.tilingScheme,
        renderTile,
        (parsedTile: ParsedTileResult) => {
          this.cacheManager.set(key, parsedTile);
        },
      );

      if (style) {
        this.renderManager.mount(key, tile, style);
      }
    }
    catch (error) {
      console.error(`[Coordinator] Failed to request tile ${key}:`, error);
    }
  }

  private resolveRenderTileKey(
    sourceId: string,
    level: number,
    x: number,
    y: number,
  ): string {
    return `${this.styleManager.getStyleEpoch()}:${sourceId}/${level}/${x}/${y}`;
  }
}
