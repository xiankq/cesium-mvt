import type { ImageryTypes, Request, Scene, TilingScheme } from '@cesium/engine';
import type { StyleSpecification } from './types';
import { Resource, UrlTemplateImageryProvider } from '@cesium/engine';
import { isDebugLoggingEnabled, logError, logWarning } from './log';
import { pickFeatureIndex } from './pick/feature-index';
import { TilesetPrimitive } from './render/tileset-primitive';
import { StyleSet } from './style/style-set';
import { createTileKey } from './tile/tile-key';
import { TileStore } from './tile/tile-store';
import { collectVisibleProviderTileCoordinates } from './visible-tile';

const fallbackImageryUrl = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export interface MvtImageryProviderOptions {
  debugLogging?: boolean;
  maxCpuCacheBytes?: number;
  maxGpuCacheBytes?: number;
  maxParseBytesPerFrame?: number;
  maxParseTilesPerFrame?: number;
  maxSourceCacheBytes?: number;
  maximumLevel?: number;
  maximumOverzoomDelta?: number;
  maxUploadBytesPerFrame?: number;
  maxUploadTilesPerFrame?: number;
  minimumLevel?: number;
  protectedFrames?: number;
  scene: Scene;
  source?: string;
  sourceCacheProtectedFrames?: number;
  staleFrameWindow?: number;
  style?: StyleSpecification;
  styleUrl?: string;
  tileSize?: number;
  tilingScheme?: TilingScheme;
}

export class MvtImageryProvider extends UrlTemplateImageryProvider {
  private readonly debugLogging: boolean;
  private hasLoggedVisibleTileCollectionWarning = false;
  private readonly placeholderCache = new PlaceholderCanvasCache();
  private readonly primitive: TilesetPrimitive;
  private readonly scene: Scene;
  private styleSet?: StyleSet;
  readonly styleReadyPromise: Promise<StyleSet>;
  private readonly tileStore: TileStore;

  constructor(options: MvtImageryProviderOptions) {
    super({
      hasAlphaChannel: true,
      maximumLevel: options.maximumLevel,
      minimumLevel: options.minimumLevel,
      tileHeight: options.tileSize ?? 256,
      tileWidth: options.tileSize ?? 256,
      tilingScheme: options.tilingScheme,
      url: fallbackImageryUrl,
    });

    if (!options.style && !options.styleUrl) {
      throw new Error('MvtImageryProvider requires either style or styleUrl.');
    }

    this.scene = options.scene;
    this.debugLogging = isDebugLoggingEnabled(options.debugLogging);
    this.tileStore = new TileStore({
      maxCpuCacheBytes: options.maxCpuCacheBytes,
      maxGpuCacheBytes: options.maxGpuCacheBytes,
      protectedFrames: options.protectedFrames,
    });
    this.primitive = new TilesetPrimitive({
      debugLogging: this.debugLogging,
      maxParseBytesPerFrame: options.maxParseBytesPerFrame,
      maxParseTilesPerFrame: options.maxParseTilesPerFrame,
      maxSourceCacheBytes: options.maxSourceCacheBytes,
      maxUploadBytesPerFrame: options.maxUploadBytesPerFrame,
      maxUploadTilesPerFrame: options.maxUploadTilesPerFrame,
      getVisibleTileCoordinates: () => this.collectVisibleTileCoordinates(),
      requestRender: () => this.scene.requestRender(),
      sourceCacheProtectedFrames: options.sourceCacheProtectedFrames,
      staleFrameWindow: options.staleFrameWindow,
      tileStore: this.tileStore,
      tilingScheme: this.tilingScheme,
    });
    this.scene.primitives.add(this.primitive as unknown as object);

    const styleReadyPromise = this.loadStyleSet(options).catch((error) => {
      logError(this.debugLogging, 'MVT style 加载失败。', {
        error,
        source: options.source,
        styleUrl: options.styleUrl,
      });
      throw error;
    });
    this.styleReadyPromise = styleReadyPromise;
    void styleReadyPromise.catch(() => {});
  }

  destroy(): undefined {
    this.scene.primitives.remove(this.primitive as unknown as object);
    this.styleSet?.clearRuntimeCaches();
    this.placeholderCache.clear();
    return this.primitive.destroy();
  }

  override pickFeatures(
    x: number,
    y: number,
    level: number,
    longitude: number,
    latitude: number,
  ): Promise<ReturnType<typeof pickFeatureIndex>> | undefined {
    const tile = this.tileStore.getTile(createTileKey({ x, y, z: level }));
    if (!tile?.featureIndex) {
      return undefined;
    }

    const pickedFeatures = pickFeatureIndex({
      coordinate: tile.coordinate,
      featureIndex: tile.featureIndex,
      imageryLayer: this,
      latitude,
      longitude,
      tileHeight: this.tileHeight,
      tileWidth: this.tileWidth,
      tilingScheme: this.tilingScheme,
    });
    return pickedFeatures.length ? Promise.resolve(pickedFeatures) : undefined;
  }

  override requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<ImageryTypes> {
    const priority = Math.max(0, level);
    const tile = this.tileStore.touchTile({ x, y, z: level }, priority);
    if (tile.state === 'idle' || tile.state === 'failed') {
      tile.setState('loading');
      this.tileStore.queueLoad(tile, priority);
      this.scene.requestRender();
    }

    const placeholder = this.placeholderCache.getOrCreate(this.styleSet?.backgroundColor);
    return Promise.resolve(placeholder);
  }

  private collectVisibleTileCoordinates() {
    const visibleTileResult = collectVisibleProviderTileCoordinates(this.scene, this);
    if (!visibleTileResult.available) {
      if (!this.hasLoggedVisibleTileCollectionWarning) {
        logWarning(
          this.debugLogging,
          '无法从 Cesium 当前 globe tile 集收集可见 MVT tile，当前帧将回退到最近请求集。',
        );
        this.hasLoggedVisibleTileCollectionWarning = true;
      }
      return [];
    }

    this.hasLoggedVisibleTileCollectionWarning = false;
    return visibleTileResult.coordinates;
  }

  private async loadStyleSet(options: MvtImageryProviderOptions): Promise<StyleSet> {
    const styleDocument = options.style
      ? { specification: options.style, url: undefined }
      : await fetchStyleSpecification(options.styleUrl!);
    const styleSet = await StyleSet
      .fromSpecification(styleDocument.specification, {
        baseUrl: styleDocument.url,
        source: options.source,
      })
      .resolveVectorSource()
      .then(resolvedStyleSet => resolvedStyleSet.resolveSpriteSource());

    this.styleSet = styleSet;
    syncProviderLevelBounds(this, styleSet, options);
    this.primitive.setStyleSet(styleSet);
    this.scene.requestRender();
    return styleSet;
  }
}

async function fetchStyleSpecification(
  styleUrl: string,
): Promise<{ specification: StyleSpecification; url: string }> {
  const resource = new Resource({ url: styleUrl });
  const styleSpecification = resource.fetchJson();
  if (!styleSpecification) {
    throw new Error(`Failed to schedule MVT style request for "${styleUrl}".`);
  }

  return {
    specification: await styleSpecification as StyleSpecification,
    url: resource.url || styleUrl,
  };
}

class PlaceholderCanvasCache {
  private readonly canvases = new Map<string, ImageryTypes>();

  clear(): void {
    this.canvases.clear();
  }

  getOrCreate(color?: string): ImageryTypes {
    const normalizedColor = color ?? 'transparent';
    const existingCanvas = this.canvases.get(normalizedColor);
    if (existingCanvas) {
      return existingCanvas;
    }

    const canvas = createPlaceholderCanvas(normalizedColor);
    this.canvases.set(normalizedColor, canvas);
    return canvas;
  }
}

function createPlaceholderCanvas(color: string): ImageryTypes {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create canvas 2D context.');
    }
    context.clearRect(0, 0, 1, 1);
    if (color !== 'transparent') {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    return canvas;
  }

  throw new Error('MvtImageryProvider requires document to create placeholder imagery.');
}

function syncProviderLevelBounds(
  provider: UrlTemplateImageryProvider,
  styleSet: StyleSet,
  options: MvtImageryProviderOptions,
): void {
  const source = styleSet.source;
  const providerLike = provider as UrlTemplateImageryProvider & {
    _maximumLevel?: number;
    _minimumLevel?: number;
  };

  if (options.maximumLevel === undefined && typeof source?.maxzoom === 'number') {
    providerLike._maximumLevel = source.maxzoom + Math.max(0, options.maximumOverzoomDelta ?? 6);
  }
  if (options.minimumLevel === undefined && typeof source?.minzoom === 'number') {
    providerLike._minimumLevel = source.minzoom;
  }
}
