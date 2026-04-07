import type { ImageryLayer, Request, Viewer } from 'cesium';
import type { MapLibreStyleDocument } from './style/document';
import type {
  MvtProviderOptions,
  MvtSchedulerSnapshot,
  MvtSourceOptions,
  TileDecodeJob,
} from './types';
import { UrlTemplateImageryProvider } from 'cesium';
import { CesiumMvtPrimitiveLayer } from './render/layer';
import { TileImageCache } from './request/image';
import { createTileDecodeJob } from './request/job';
import { TileScheduler } from './scheduler/scheduler';
import { CesiumMvtSourceCache } from './scheduler/source';
import { resolveMapLibreStyleBackgroundColor } from './style/renderer';

type SchedulerListener = (snapshot: MvtSchedulerSnapshot) => void;

export type MvtImageryProviderOptions = MvtProviderOptions & {
  viewer: Viewer;
  style?: MapLibreStyleDocument;
};

export class MvtImageryProvider extends UrlTemplateImageryProvider {
  readonly scheduler: TileScheduler;

  private readonly viewer: Viewer;
  private sourceCache?: CesiumMvtSourceCache;
  private imageryLayer?: ImageryLayer;
  private readonly tileRequestSource: MvtSourceOptions;
  private readonly tileImageCache = new TileImageCache();
  private readonly backgroundTileFillStyle?: string;
  private previewLayer?: CesiumMvtPrimitiveLayer;
  private destroyed = false;

  constructor(options: MvtImageryProviderOptions) {
    const {
      viewer,
      source,
      style,
      maxConcurrentRequests,
      cacheSize,
    } = options;
    const backgroundColor = style
      ? resolveMapLibreStyleBackgroundColor(style)
      : undefined;

    super({
      ...source,
      url: source.urlTemplate,
      enablePickFeatures: false,
      hasAlphaChannel: true,
    });

    this.viewer = viewer;
    this.tileRequestSource = {
      ...source,
      maximumLevel: this.maximumLevel,
      tilingScheme: this.tilingScheme,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
    };
    this.backgroundTileFillStyle = backgroundColor?.toCssColorString();
    this.scheduler = new TileScheduler(
      source.id,
      maxConcurrentRequests,
      cacheSize,
    );
    let imageryLayer: ImageryLayer | undefined;
    let sourceCache: CesiumMvtSourceCache | undefined;
    let previewLayer: CesiumMvtPrimitiveLayer | undefined;

    try {
      imageryLayer = viewer.scene.imageryLayers.addImageryProvider(this);
      sourceCache = new CesiumMvtSourceCache({
        scene: viewer.scene,
        scheduler: this.scheduler,
        tilingScheme: this.tilingScheme,
        source,
        imageryLayer,
      });

      if (style) {
        previewLayer = new CesiumMvtPrimitiveLayer(
          viewer.scene,
          this.scheduler,
          this.tilingScheme,
          {
            style,
            sourceCache,
          },
        );
      }

      this.imageryLayer = imageryLayer;
      this.sourceCache = sourceCache;
      this.previewLayer = previewLayer;
    }
    catch (error) {
      previewLayer?.destroy();
      sourceCache?.destroy();
      if (imageryLayer) {
        viewer.scene.imageryLayers.remove(imageryLayer, true);
      }
      this.scheduler.destroy();
      throw error;
    }
  }

  subscribe(listener: SchedulerListener): () => void {
    return this.scheduler.subscribe(listener);
  }

  override requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<HTMLCanvasElement> {
    const sourceCache = this.sourceCache;
    if (!sourceCache) {
      return Promise.resolve(
        this.tileImageCache.get(
          this.tileWidth,
          this.tileHeight,
          this.backgroundTileFillStyle,
        ),
      );
    }

    const coord = { x, y, level };
    sourceCache.touch(coord);

    const job: TileDecodeJob = createTileDecodeJob(
      this.tileRequestSource,
      this.tilingScheme,
      coord,
    );

    this.scheduler.schedule(job);

    return Promise.resolve(
      this.tileImageCache.get(
        this.tileWidth,
        this.tileHeight,
        this.backgroundTileFillStyle,
      ),
    );
  }

  override pickFeatures(
    _x: number,
    _y: number,
    _level: number,
    _longitude: number,
    _latitude: number,
  ): undefined {
    return undefined;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.previewLayer?.destroy();
    this.previewLayer = undefined;
    this.tileImageCache.clear();
    this.sourceCache?.destroy();
    this.sourceCache = undefined;
    if (this.imageryLayer) {
      this.viewer.scene.imageryLayers.remove(this.imageryLayer, true);
      this.imageryLayer = undefined;
    }
    this.scheduler.destroy();
  }
}
