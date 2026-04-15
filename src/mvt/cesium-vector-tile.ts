import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Resource } from 'cesium';
import type { FrameState as CesiumVectorTileCoordinatorFrameState } from './cesium-vector-tile-coordinator';
import type { QueryRenderedFeaturesOptions, RenderedFeature } from './render';
import type { QuerySourceFeaturesOptions } from './source/source-query';
import type { FeatureStateTarget } from './style/feature-state-store';
import type { StyleSet } from './style/style-loader';
import { BoundingSphere, PrimitiveCollection, Rectangle, WebMercatorTilingScheme } from 'cesium';
import { CesiumVectorTileCoordinator } from './cesium-vector-tile-coordinator';
import { loadStyleSet } from './style/style-loader';

export interface CesiumVectorTileOptions {
  crossSourceCollisions?: boolean;
  maximumLevel?: number;
  minimumLevel?: number;
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
  private readonly root = new PrimitiveCollection();
  private readonly coordinator: CesiumVectorTileCoordinator;
  private styleLoadToken = 0;
  private styleSetPromise?: Promise<StyleSet>;

  static async fromUrl(
    url: string | URL | Resource,
    options: CesiumVectorTileFromUrlOptions = {},
  ): Promise<CesiumVectorTile> {
    const vectorTile = new CesiumVectorTile(options);

    try {
      await vectorTile.loadAndApplyStyle(url);
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
      crossSourceCollisions: options.crossSourceCollisions,
      maximumLevel: options.maximumLevel,
      minimumLevel: options.minimumLevel ?? 0,
      rectangle: this._rectangle,
      root: this.root,
      tileWidth: options.tileWidth ?? 256,
      tilingScheme,
    });

    this.add(this.root);

    if (options.style) {
      this.loadAndApplyStyle(options.style);
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

  update(frameState: any): void {
    if (this.destroyed) {
      return;
    }

    super.update(frameState);

    this.coordinator.update({
      camera: frameState.camera,
      viewportWidth: frameState.context?.drawingBufferWidth ?? 0,
    });
  }

  updateStyle(style: StyleSpecification): Promise<void> {
    if (this.destroyed) {
      return Promise.resolve();
    }

    return this.loadAndApplyStyle(style).then(() => {});
  }

  setFeatureState(
    target: FeatureStateTarget,
    state: Record<string, unknown>,
  ): void {
    if (this.destroyed) {
      return;
    }

    this.coordinator.setFeatureState(target, state);
  }

  prePassesUpdate(frameState: CesiumVectorTileCoordinatorFrameState): void {
    if (this.destroyed) {
      return;
    }

    super.prePassesUpdate(frameState);
    this.coordinator.prePassesUpdate(frameState);
  }

  getStyle(): StyleSpecification | undefined {
    return this.coordinator.getStyle();
  }

  querySourceFeatures(
    sourceId: string,
    options: QuerySourceFeaturesOptions = {},
  ) {
    return this.coordinator.querySourceFeatures(sourceId, options);
  }

  queryRenderedFeatures(
    options: QueryRenderedFeaturesOptions = {},
  ): RenderedFeature[] {
    return this.coordinator.queryRenderedFeatures(options);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  override destroy(): this {
    if (this.destroyed) {
      return this;
    }

    this.destroyed = true;
    this.coordinator.destroy();
    super.destroy();
    return this;
  }

  private loadAndApplyStyle(
    style: string | URL | Resource | StyleSpecification,
  ): Promise<StyleSet> {
    const loadToken = ++this.styleLoadToken;
    const styleSetPromise = loadStyleSet({
      style,
    }).then((styleSet) => {
      if (!this.destroyed && this.styleLoadToken === loadToken) {
        this.coordinator.updateStyle(styleSet.style);
      }
      return styleSet;
    });

    this.styleSetPromise = styleSetPromise;
    return styleSetPromise;
  }
}
