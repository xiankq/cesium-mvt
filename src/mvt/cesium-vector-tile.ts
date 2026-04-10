import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleSet } from './style/style-set';
import { BoundingSphere, Event, PrimitiveCollection, Rectangle, WebMercatorTilingScheme } from 'cesium';
import { CesiumVectorTileCoordinator } from './cesium-vector-tile-coordinator';
import { loadStyleSet } from './style/style-loader';

export interface TileLoadEvent {
  readonly sourceId: string;
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

export interface TileFailedEvent {
  readonly sourceId: string;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly error: unknown;
}

export interface CesiumVectorTileOptions {
  maximumLevel?: number;
  minimumLevel?: number;
  onError?: (error: unknown) => void;
  rectangle?: Rectangle;
  style?: string | StyleSpecification;
  tileWidth?: number;
  tilingScheme?: WebMercatorTilingScheme;
}

export type CesiumVectorTileFromUrlOptions = Omit<
  CesiumVectorTileOptions,
  'style'
>;

export class CesiumVectorTile extends PrimitiveCollection {
  private destroyed = false;
  private readonly _rectangle: Rectangle;
  private readonly _tileLoad = new Event();
  private readonly _tileFailed = new Event();

  private readonly root = new PrimitiveCollection();
  private readonly coordinator: CesiumVectorTileCoordinator;
  private styleSetPromise?: Promise<StyleSet>;

  static async fromUrl(
    url: string | URL,
    options: CesiumVectorTileFromUrlOptions = {},
  ): Promise<CesiumVectorTile> {
    const vectorTile = new CesiumVectorTile({
      ...options,
      style: url.toString(),
    });

    try {
      await vectorTile.styleSetPromise;
      return vectorTile;
    }
    catch (error) {
      vectorTile.destroy();
      throw error;
    }
  }

  constructor(options: CesiumVectorTileOptions = {}) {
    super();

    this._rectangle = options.rectangle ?? Rectangle.MAX_VALUE;
    const tilingScheme = options.tilingScheme ?? new WebMercatorTilingScheme();

    this.coordinator = new CesiumVectorTileCoordinator({
      maximumLevel: options.maximumLevel,
      minimumLevel: options.minimumLevel ?? 0,
      rectangle: this._rectangle,
      root: this.root,
      tileWidth: options.tileWidth ?? 256,
      tilingScheme,
    });

    this.add(this.root);

    if (options.style) {
      this.styleSetPromise = loadStyleSet({
        style: options.style,
      }).then((styleSet) => {
        if (!this.destroyed) {
          this.coordinator.updateStyle(styleSet.style);
        }
        return styleSet;
      });
    }
  }

  get readyPromise(): Promise<void> {
    return this.styleSetPromise?.then(() => {}) ?? Promise.resolve();
  }

  get boundingSphere(): BoundingSphere {
    return BoundingSphere.fromRectangle3D(this._rectangle);
  }

  get rectangle(): Rectangle {
    return this._rectangle;
  }

  get tileLoad(): Event<(event: TileLoadEvent) => void> {
    return this._tileLoad;
  }

  get tileFailed(): Event<(event: TileFailedEvent) => void> {
    return this._tileFailed;
  }

  update(frameState: any): void {
    (PrimitiveCollection.prototype as any).update.call(this, frameState);

    if (this.destroyed) {
      return;
    }

    this.coordinator.update({
      camera: frameState.camera,
      viewportHeight: frameState.context?.drawingBufferHeight ?? 0,
      viewportWidth: frameState.context?.drawingBufferWidth ?? 0,
    });
  }

  updateStyle(style: StyleSpecification): void {
    if (this.destroyed) {
      return;
    }

    this.coordinator.updateStyle(style);
  }

  getStyle(): StyleSpecification | undefined {
    return this.coordinator.getStyle();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  override destroy(): this {
    if (this.destroyed) {
      return this;
    }

    this.coordinator.destroy();
    this.destroyed = true;
    super.destroy();
    return this;
  }
}
