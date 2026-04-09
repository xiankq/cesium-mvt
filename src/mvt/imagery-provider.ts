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
import { createStyleSet } from './style/style-set';

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

export type StyleImageryProviderFromUrlOptions = Omit<
  StyleImageryProviderOptions,
  'style'
>;

type SolidImage
  = | HTMLCanvasElement
    | {
      color: string;
      height: number;
      width: number;
    };

interface CircleFallbackTarget {
  sourceId: string;
  sourceLayer?: string;
}

const CIRCLE_FALLBACK_LAYER_ID = '__cesium-mvt-circle-fallback__';
const CIRCLE_FALLBACK_SOURCE_LAYER_PRIORITIES = ['place', 'poi'];
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

  static async fromUrl(
    url: string | URL,
    options: StyleImageryProviderFromUrlOptions,
  ): Promise<StyleImageryProvider> {
    const provider = new StyleImageryProvider({
      ...options,
      style: url.toString(),
    });

    try {
      await provider.styleSetPromise;
      return provider;
    }
    catch (error) {
      provider.destroy();
      throw error;
    }
  }

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
    this.sceneLayer = new SceneLayer(this.scene, {
      maximumLevel: this.maximumLevel,
      minimumLevel: this.minimumLevel,
      onError: (error) => {
        if (!this.destroyed) {
          this.errorEvent.raiseEvent(error);
          this.scene.requestRender();
        }
      },
      rectangle: this.rectangle,
      tileWidth: this.tileWidth,
      tilingScheme: this.tilingScheme,
    });
    this.styleSetPromise = loadStyleSet({
      style: options.style,
    }).then((styleSet) => {
      const resolvedStyleSet = prepareRenderableStyleSet(
        styleSet,
        typeof options.style === 'string',
      );
      if (this.destroyed) {
        return resolvedStyleSet;
      }

      this.sceneLayer.updateStyle(resolvedStyleSet);
      this.scene.requestRender();
      return resolvedStyleSet;
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

function prepareRenderableStyleSet(
  styleSet: StyleSet,
  shouldInjectCircleFallback: boolean,
) {
  if (!shouldInjectCircleFallback) {
    return styleSet;
  }

  const preparedStyle = injectCircleFallbackLayerIfNeeded(styleSet.style);
  if (preparedStyle === styleSet.style) {
    return styleSet;
  }

  return createStyleSet(preparedStyle, styleSet.styleUrl);
}

function injectCircleFallbackLayerIfNeeded(
  style: StyleSpecification,
): StyleSpecification {
  if (style.layers.some(layer => layer.type === 'circle' || layer.id === CIRCLE_FALLBACK_LAYER_ID)) {
    return style;
  }

  const target = findCircleFallbackTarget(style);
  if (!target) {
    return style;
  }

  const nextStyle = cloneStyle(style);
  nextStyle.layers = nextStyle.layers.concat(createCircleFallbackLayer(target));
  return nextStyle;
}

function findCircleFallbackTarget(
  style: StyleSpecification,
): CircleFallbackTarget | undefined {
  const candidates = style.layers
    .filter(isSymbolLayerWithSource)
    .map((layer) => {
      const source = style.sources[layer.source];
      if (!source) {
        return undefined;
      }

      if (source.type === 'vector' && typeof layer['source-layer'] === 'string') {
        return {
          sourceId: layer.source,
          sourceLayer: layer['source-layer'],
        } satisfies CircleFallbackTarget;
      }

      if (source.type === 'geojson') {
        return {
          sourceId: layer.source,
        } satisfies CircleFallbackTarget;
      }

      return undefined;
    })
    .filter((candidate): candidate is CircleFallbackTarget => Boolean(candidate));

  if (candidates.length === 0) {
    return undefined;
  }

  for (const sourceLayer of CIRCLE_FALLBACK_SOURCE_LAYER_PRIORITIES) {
    const candidate = candidates.find(entry => entry.sourceLayer === sourceLayer);
    if (candidate) {
      return candidate;
    }
  }

  return candidates[0];
}

function isSymbolLayerWithSource(
  layer: StyleSpecification['layers'][number],
): layer is Extract<StyleSpecification['layers'][number], { source: string; type: 'symbol' }> {
  return layer.type === 'symbol' && typeof layer.source === 'string';
}

function createCircleFallbackLayer(
  target: CircleFallbackTarget,
) {
  return {
    id: CIRCLE_FALLBACK_LAYER_ID,
    paint: {
      'circle-color': '#ff3b30',
      'circle-opacity': 0.9,
      'circle-radius': 4,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
    source: target.sourceId,
    ...(target.sourceLayer
      ? {
          'source-layer': target.sourceLayer,
        }
      : {}),
    type: 'circle',
  } satisfies StyleSpecification['layers'][number];
}

function cloneStyle(style: StyleSpecification): StyleSpecification {
  if (typeof structuredClone === 'function') {
    return structuredClone(style);
  }

  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
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
