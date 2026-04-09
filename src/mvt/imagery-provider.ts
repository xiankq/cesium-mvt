import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  ImageryLayerFeatureInfo,
  ImageryProvider,
  ImageryTypes,
  Proxy,
  Rectangle,
  Request,
  Scene,
  TileDiscardPolicy,
} from 'cesium';
import type { StyleSet } from './style/style-set';
import {
  Credit,
  Event,
  WebMercatorTilingScheme,
} from 'cesium';
import { SceneLayer } from './scene-layer';
import { loadStyleSet } from './style/style-loader';

// ImageryProvider 继续作为对外门面，真正的矢量渲染运行在 SceneLayer 中。
export interface StyleImageryProviderOptions {
  credit?: Credit | string;
  maximumLevel?: number;
  minimumLevel?: number;
  rectangle?: Rectangle;
  scene: Scene;
  style: string | StyleSpecification;
  tileHeight?: number;
  tileWidth?: number;
  tilingScheme?: WebMercatorTilingScheme;
}

type SolidImage
  = | HTMLCanvasElement
    | {
      color: string;
      height: number;
      width: number;
    };

const TRANSPARENT_COLOR = 'rgba(0,0,0,0)';

export class StyleImageryProvider implements ImageryProvider {
  readonly credit: Credit;
  readonly errorEvent = new Event();
  readonly hasAlphaChannel = true;
  readonly maximumLevel: number | undefined;
  readonly minimumLevel: number;
  readonly proxy: Proxy;
  readonly rectangle: Rectangle;
  readonly tileDiscardPolicy: TileDiscardPolicy;
  readonly tileHeight: number;
  readonly tileWidth: number;
  readonly tilingScheme: WebMercatorTilingScheme;

  private destroyed = false;
  private readonly scene: Scene;
  private readonly sceneLayer: SceneLayer;
  private readonly solidImageCache = new Map<string, SolidImage>();
  private readonly styleSetPromise: Promise<StyleSet>;

  constructor(options: StyleImageryProviderOptions) {
    this.scene = options.scene;
    this.credit = createCredit(options.credit) as Credit;
    this.minimumLevel = options.minimumLevel ?? 0;
    this.maximumLevel = options.maximumLevel;
    this.tilingScheme = options.tilingScheme ?? new WebMercatorTilingScheme();
    this.rectangle = options.rectangle ?? this.tilingScheme.rectangle;
    this.tileWidth = options.tileWidth ?? 256;
    this.tileHeight = options.tileHeight ?? 256;
    this.proxy = undefined as unknown as Proxy;
    this.tileDiscardPolicy = undefined as unknown as TileDiscardPolicy;
    this.sceneLayer = new SceneLayer(this.scene);
    this.styleSetPromise = loadStyleSet({
      style: options.style,
    }).then((styleSet) => {
      if (this.destroyed) {
        return styleSet;
      }

      this.sceneLayer.updateStyle(styleSet);
      this.scene.requestRender();
      return styleSet;
    }).catch((error) => {
      if (!this.destroyed) {
        this.errorEvent.raiseEvent(error);
        this.scene.requestRender();
      }

      throw error;
    });
  }

  async requestImage(
    _x: number,
    _y: number,
    _level: number,
    _request?: Request,
  ): Promise<ImageryTypes> {
    // requestImage 只负责维持 Cesium 的 imagery 生命周期。
    // 真正的矢量内容通过 SceneLayer 挂载到 primitive 管线中。
    const styleSet = await this.styleSetPromise;
    const backgroundColor = styleSet?.backgroundColor ?? TRANSPARENT_COLOR;
    return this.getSolidImage(backgroundColor) as ImageryTypes;
  }

  pickFeatures(
    _x: number,
    _y: number,
    _level: number,
    _longitude: number,
    _latitude: number,
  ): Promise<ImageryLayerFeatureInfo[]> {
    return Promise.resolve([]);
  }

  getTileCredits() {
    return this.credit ? [this.credit] : [];
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.sceneLayer.destroy();
    this.solidImageCache.clear();
    this.destroyed = true;
  }

  private getSolidImage(color: string) {
    const cachedImage = this.solidImageCache.get(color);
    if (cachedImage) {
      return cachedImage;
    }

    const image = createSolidImage(color);
    this.solidImageCache.set(color, image);
    return image;
  }
}

function createCredit(credit?: Credit | string) {
  if (typeof credit === 'string') {
    return new Credit(credit);
  }

  return credit;
}

function createSolidImage(color: string): SolidImage {
  if (typeof document !== 'undefined') {
    // 每种颜色复用一张共享的 1x1 小图，避免按瓦片重复创建对象。
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    return canvas;
  }

  return {
    color,
    height: 1,
    width: 1,
  } as unknown as HTMLCanvasElement;
}
