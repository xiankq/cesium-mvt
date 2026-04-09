import type { SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type {
  Rectangle,
  Scene,
} from 'cesium';
import type { FeatureTile } from './render/feature-tile';
import type { RenderEntry } from './render/render-order';
import type { RenderTile } from './render/render-tile';
import type { RenderedTileHandle } from './render/rendered-tile';
import type { TileFrameResult } from './source/tile-manager';
import type { TileCoordinate } from './source/tile-request';
import type { ParsedTile } from './source/vector-tile';
import type { LayerFamily } from './style/layer-family';
import type { StyleSet } from './style/style-set';
import type { TileAvailability } from './tile-selection';
import type { SceneViewTileSelection } from './view-state';
import { PrimitiveCollection, WebMercatorTilingScheme } from 'cesium';
import { compileFeatureTile } from './render/feature-tile';
import { createRenderOrder } from './render/render-order';
import {
  compileRenderTile,
  createRenderTileKey,
  createScopedRenderTileKey,
} from './render/render-tile';
import {
  createEmptyRenderedTileHandle,
  createRenderedTileHandle,
  destroyRenderedTileHandle,
  mountRenderedTileHandle,

  setRenderedTileVisibility,
} from './render/rendered-tile';
import { GeojsonSourceCache } from './source/geojson-source-cache';
import { SourceCache } from './source/source-cache';
import { TileManager } from './source/tile-manager';
import { loadVectorTile } from './source/vector-tile';
import { createLayerFamilies } from './style/layer-family';
import { resolveTileSelection } from './tile-selection';
import { collectSceneViewTileSelection } from './view-state';

// SceneLayer 统一持有 Cesium 侧运行时对象：source cache、解析结果、
// 渲染计划以及已挂载的 primitive 句柄。ImageryProvider 只把入口请求委托到这里。
interface ParsedSourceCache {
  readonly sourceType: SourceSpecification['type'];
  destroy: () => void;
  isDestroyed: () => boolean;
  requestTile: (coordinate: TileCoordinate) => Promise<ParsedTile>;
  updateSource: (source: SourceSpecification) => void;
}

export interface SceneLayerOptions {
  maximumLevel?: number;
  minimumLevel?: number;
  onError?: (error: unknown) => void;
  rectangle?: Rectangle;
  tileWidth?: number;
  tilingScheme?: WebMercatorTilingScheme;
}

export class SceneLayer {
  readonly tileManager = new TileManager();

  private currentFrame = 0;
  private readonly maximumLevel: number | undefined;
  private readonly minimumLevel: number;
  private readonly onError?: (error: unknown) => void;
  private readonly rectangle: Rectangle;
  private readonly scene: Scene;
  private readonly root: PrimitiveCollection;
  private readonly removePostRenderListener?: () => void;
  private readonly removePreRenderListener?: () => void;
  private readonly sourceCaches = new Map<string, ParsedSourceCache>();
  private readonly tileWidth: number;
  private readonly tilingScheme: WebMercatorTilingScheme;
  private destroyed = false;
  private frameUpdateActive = false;
  private frameUpdatePending = true;
  private readonly featureTilePromises = new Map<string, Promise<FeatureTile>>();
  private readonly featureTiles = new Map<string, FeatureTile>();
  private layerFamilies: LayerFamily[] = [];
  private lastViewSelectionKey?: string;
  private readonly renderedTilePromises = new Map<string, Promise<RenderedTileHandle>>();
  private readonly renderedTileHandles = new Map<string, RenderedTileHandle>();
  private readonly renderTiles = new Map<string, RenderTile>();
  private renderOrder: RenderEntry[] = [];
  private styleSet?: StyleSet;
  private styleEpoch = 0;

  constructor(scene: Scene, options: SceneLayerOptions = {}) {
    this.scene = scene;
    this.minimumLevel = options.minimumLevel ?? 0;
    this.maximumLevel = options.maximumLevel;
    this.onError = options.onError;
    this.tilingScheme = options.tilingScheme ?? new WebMercatorTilingScheme();
    this.rectangle = options.rectangle ?? this.tilingScheme.rectangle;
    this.tileWidth = options.tileWidth ?? 256;
    this.root = new PrimitiveCollection();
    this.scene.primitives.add(this.root);
    this.removePreRenderListener = this.scene.preRender?.addEventListener(() => {
      this.beginFrameUpdateIfNeeded();
    });
    this.removePostRenderListener = this.scene.postRender?.addEventListener(() => {
      if (!this.frameUpdateActive) {
        return;
      }

      this.frameUpdateActive = false;
      const frameResult = this.tileManager.endFrame();
      this.applyFrameResult(frameResult);
    });
  }

  updateStyle(styleSet: StyleSet) {
    this.styleSet = styleSet;
    // styleEpoch 变化后，上一版样式派生出来的 render/feature cache 都要失效。
    this.styleEpoch += 1;
    this.layerFamilies = createLayerFamilies(styleSet.style);
    this.clearRenderedTileHandles();
    this.renderedTilePromises.clear();
    this.featureTilePromises.clear();
    this.featureTiles.clear();
    this.renderOrder = createRenderOrder(styleSet.style, this.layerFamilies);
    this.renderTiles.clear();
    this.frameUpdatePending = true;
    this.lastViewSelectionKey = undefined;
    this.reconcileSourceCaches(styleSet.style.sources);
  }

  getStyle() {
    return this.styleSet;
  }

  getSourceCache(sourceId: string) {
    return this.sourceCaches.get(sourceId);
  }

  getLayerFamilies() {
    return this.layerFamilies;
  }

  getRenderOrder() {
    return this.renderOrder;
  }

  getRenderTile(sourceId: string, level: number, x: number, y: number) {
    if (!this.styleSet) {
      throw new Error('Style has not been initialized.');
    }

    const baseKey = createRenderTileKey(sourceId, level, x, y);
    const renderTileKey = createScopedRenderTileKey(baseKey, this.styleEpoch);
    const cachedRenderTile = this.renderTiles.get(renderTileKey);
    if (cachedRenderTile) {
      return cachedRenderTile;
    }

    const renderTile = compileRenderTile({
      key: baseKey,
      layerFamilies: this.layerFamilies,
      renderOrder: this.renderOrder,
      style: this.styleSet.style,
      styleEpoch: this.styleEpoch,
    });
    this.renderTiles.set(renderTile.key, renderTile);
    return renderTile;
  }

  async getFeatureTile(sourceId: string, level: number, x: number, y: number) {
    if (!this.styleSet) {
      throw new Error('Style has not been initialized.');
    }

    const sourceCache = this.sourceCaches.get(sourceId);
    if (!sourceCache) {
      throw new Error(`Source cache not found: ${sourceId}`);
    }

    const baseKey = createRenderTileKey(sourceId, level, x, y);
    const renderTileKey = createScopedRenderTileKey(baseKey, this.styleEpoch);
    const cachedFeatureTile = this.featureTiles.get(renderTileKey);
    if (cachedFeatureTile) {
      return cachedFeatureTile;
    }

    const pendingFeatureTile = this.featureTilePromises.get(renderTileKey);
    if (pendingFeatureTile) {
      return pendingFeatureTile;
    }

    const layerFamilies = this.layerFamilies;
    const renderOrder = this.renderOrder;
    const style = this.styleSet.style;
    const styleEpoch = this.styleEpoch;
    const featureTilePromise = sourceCache.requestTile({
      level,
      x,
      y,
    }).then((tile) => {
      const renderTile = this.renderTiles.get(renderTileKey)
        ?? compileRenderTile({
          key: baseKey,
          layerFamilies,
          renderOrder,
          style,
          styleEpoch,
        });
      this.renderTiles.set(renderTile.key, renderTile);
      const featureTile = compileFeatureTile({
        renderTile,
        tile,
      });
      this.featureTiles.set(featureTile.key, featureTile);
      return featureTile;
    }).finally(() => {
      this.featureTilePromises.delete(renderTileKey);
    });

    this.featureTilePromises.set(renderTileKey, featureTilePromise);
    return featureTilePromise;
  }

  async ensureRenderedTile(sourceId: string, level: number, x: number, y: number) {
    if (!this.styleSet) {
      throw new Error('Style has not been initialized.');
    }

    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    const styleEpoch = this.styleEpoch;
    const cachedHandle = this.renderedTileHandles.get(renderTileKey);
    if (cachedHandle) {
      return cachedHandle;
    }

    const pendingHandle = this.renderedTilePromises.get(renderTileKey);
    if (pendingHandle) {
      return pendingHandle;
    }

    const renderedTilePromise = this.getFeatureTile(sourceId, level, x, y)
      .then((featureTile) => {
        if (this.destroyed || styleEpoch !== this.styleEpoch || !this.styleSet) {
          return createEmptyRenderedTileHandle(renderTileKey);
        }

        const renderedTileHandle = createRenderedTileHandle({
          featureTile,
          level,
          style: this.styleSet.style,
          tilingScheme: this.tilingScheme,
          x,
          y,
        });
        mountRenderedTileHandle(this.root, renderedTileHandle);
        this.renderedTileHandles.set(renderedTileHandle.key, renderedTileHandle);
        this.frameUpdatePending = true;
        if (renderedTileHandle.byteLength > 0) {
          this.scene.requestRender();
        }
        return renderedTileHandle;
      })
      .finally(() => {
        this.renderedTilePromises.delete(renderTileKey);
      });

    this.renderedTilePromises.set(renderTileKey, renderedTilePromise);
    return renderedTilePromise;
  }

  async requestTileHint(level: number, x: number, y: number) {
    const sourceIds = getRenderableSourceIds(this.layerFamilies);
    await Promise.all(sourceIds.map(sourceId => this.requestSourceTileHint(sourceId, level, x, y)));
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    for (const sourceCache of this.sourceCaches.values()) {
      sourceCache.destroy();
    }
    this.sourceCaches.clear();
    this.clearRenderedTileHandles();
    this.renderedTilePromises.clear();
    this.featureTilePromises.clear();
    this.featureTiles.clear();
    this.layerFamilies = [];
    this.renderTiles.clear();
    this.renderOrder = [];
    this.removePreRenderListener?.();
    this.removePostRenderListener?.();
    this.scene.primitives.remove(this.root);
    this.destroyed = true;
  }

  private reconcileSourceCaches(sources: Record<string, SourceSpecification>) {
    const nextSourceIds = new Set(Object.keys(sources));

    for (const [sourceId, source] of Object.entries(sources)) {
      const sourceCache = this.sourceCaches.get(sourceId);
      if (sourceCache && sourceCache.sourceType === source.type) {
        sourceCache.updateSource(source);
        continue;
      }

      sourceCache?.destroy();
      this.sourceCaches.delete(sourceId);

      const nextSourceCache = createParsedSourceCache(sourceId, source);
      if (nextSourceCache) {
        this.sourceCaches.set(sourceId, nextSourceCache);
      }
    }

    for (const [sourceId, sourceCache] of this.sourceCaches) {
      if (nextSourceIds.has(sourceId)) {
        continue;
      }

      sourceCache.destroy();
      this.sourceCaches.delete(sourceId);
    }
  }

  private clearRenderedTileHandles() {
    for (const handle of this.renderedTileHandles.values()) {
      destroyRenderedTileHandle(this.root, handle);
    }
    this.renderedTileHandles.clear();
  }

  private applyFrameResult(frameResult: TileFrameResult) {
    let sceneChanged = false;

    for (const key of frameResult.hiddenKeys) {
      const handle = this.renderedTileHandles.get(key);
      if (!handle) {
        continue;
      }

      sceneChanged = setRenderedTileVisibility(handle, false) || sceneChanged;
    }

    for (const key of frameResult.unloadableKeys) {
      const handle = this.renderedTileHandles.get(key);
      if (!handle) {
        continue;
      }

      destroyRenderedTileHandle(this.root, handle);
      this.renderedTileHandles.delete(key);
      sceneChanged = handle.byteLength > 0 || sceneChanged;
    }

    if (sceneChanged) {
      this.scene.requestRender();
    }
    this.frameUpdatePending = frameResult.hiddenKeys.length > 0;
  }

  private beginFrameUpdateIfNeeded(): void {
    const tileSelection = collectSceneViewTileSelection({
      camera: this.scene.camera,
      maximumLevel: this.maximumLevel,
      minimumLevel: this.minimumLevel,
      rectangle: this.rectangle,
      tileWidth: this.tileWidth,
      tilingScheme: this.tilingScheme,
      viewportWidth: resolveSceneViewportWidth(this.scene),
    });
    if (!this.shouldUpdateFrame(tileSelection)) {
      return;
    }

    this.frameUpdateActive = true;
    this.frameUpdatePending = false;
    this.lastViewSelectionKey = tileSelection?.key;
    this.currentFrame += 1;
    this.tileManager.beginFrame(this.currentFrame);
    if (!tileSelection) {
      return;
    }

    const sourceIds = getRenderableSourceIds(this.layerFamilies);
    void Promise.all(
      sourceIds.map(sourceId => this.requestVisibleTilesForSource(
        sourceId,
        tileSelection.coordinates,
      )),
    ).catch((error) => {
      this.onError?.(error);
    });
  }

  private shouldUpdateFrame(tileSelection: SceneViewTileSelection | undefined): boolean {
    if (this.frameUpdatePending) {
      return true;
    }

    if (!tileSelection && this.renderedTileHandles.size > 0) {
      return true;
    }

    return tileSelection?.key !== this.lastViewSelectionKey;
  }

  private async requestVisibleTilesForSource(
    sourceId: string,
    coordinates: readonly TileCoordinate[],
  ): Promise<void> {
    const tileSelection = resolveTileSelection({
      coordinates,
      getAvailability: coordinate => this.getTileAvailability(
        sourceId,
        coordinate.level,
        coordinate.x,
        coordinate.y,
      ),
      minimumLevel: this.minimumLevel,
    });

    for (const coordinate of tileSelection.readyCoordinates) {
      this.showResolvedTile(sourceId, coordinate.level, coordinate.x, coordinate.y);
    }

    for (const coordinate of tileSelection.emptyCoordinates) {
      this.retainResolvedTile(sourceId, coordinate.level, coordinate.x, coordinate.y);
    }

    for (const coordinate of tileSelection.fallbackCoordinates) {
      this.showResolvedTile(sourceId, coordinate.level, coordinate.x, coordinate.y);
    }

    await Promise.all(
      tileSelection.requestCoordinates.map(coordinate => this.requestSourceTileHint(
        sourceId,
        coordinate.level,
        coordinate.x,
        coordinate.y,
      )),
    );
  }

  private async requestSourceTileHint(sourceId: string, level: number, x: number, y: number): Promise<void> {
    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    this.tileManager.markCandidate(renderTileKey);
    this.tileManager.markSelected(renderTileKey);

    const cachedHandle = this.renderedTileHandles.get(renderTileKey);
    if (cachedHandle) {
      if (cachedHandle.byteLength > 0) {
        const visibilityChanged = setRenderedTileVisibility(cachedHandle, true);
        this.tileManager.markShown(renderTileKey);
        if (visibilityChanged) {
          this.scene.requestRender();
        }
      }
      else {
        this.tileManager.touch(renderTileKey);
      }
      return;
    }

    this.tileManager.setBlockers(renderTileKey, {
      requesting: true,
    });

    try {
      const renderedTileHandle = await this.ensureRenderedTile(sourceId, level, x, y);
      this.tileManager.setBlockers(renderTileKey, {
        requesting: false,
      });
      if (renderedTileHandle.byteLength > 0) {
        this.tileManager.markShown(renderTileKey);
      }
      else {
        this.tileManager.touch(renderTileKey);
      }
    }
    catch (error) {
      this.tileManager.setBlockers(renderTileKey, {
        requesting: false,
      });
      throw error;
    }
  }

  private getTileAvailability(sourceId: string, level: number, x: number, y: number): TileAvailability {
    const renderedTileHandle = this.renderedTileHandles.get(
      this.resolveRenderTileKey(sourceId, level, x, y),
    );
    if (!renderedTileHandle) {
      return 'missing';
    }

    return renderedTileHandle.byteLength > 0 ? 'ready' : 'empty';
  }

  private retainResolvedTile(sourceId: string, level: number, x: number, y: number): void {
    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    this.tileManager.markCandidate(renderTileKey);
    this.tileManager.markSelected(renderTileKey);
    this.tileManager.touch(renderTileKey);
  }

  private showResolvedTile(sourceId: string, level: number, x: number, y: number): void {
    const renderTileKey = this.resolveRenderTileKey(sourceId, level, x, y);
    const renderedTileHandle = this.renderedTileHandles.get(renderTileKey);
    if (!renderedTileHandle) {
      return;
    }

    if (renderedTileHandle.byteLength === 0) {
      this.retainResolvedTile(sourceId, level, x, y);
      return;
    }

    const visibilityChanged = setRenderedTileVisibility(renderedTileHandle, true);
    this.tileManager.markShown(renderTileKey);
    if (visibilityChanged) {
      this.scene.requestRender();
    }
  }

  private resolveRenderTileKey(sourceId: string, level: number, x: number, y: number): string {
    return createScopedRenderTileKey(
      createRenderTileKey(sourceId, level, x, y),
      this.styleEpoch,
    );
  }
}

function createParsedSourceCache(
  sourceId: string,
  source: SourceSpecification,
): ParsedSourceCache | undefined {
  if (source.type === 'vector') {
    return new SourceCache({
      loadTile: loadVectorTile,
      source,
      sourceId,
    });
  }

  if (source.type === 'geojson') {
    return new GeojsonSourceCache({
      source,
      sourceId,
    });
  }

  return undefined;
}

function getRenderableSourceIds(layerFamilies: LayerFamily[]): string[] {
  return [...new Set(layerFamilies.map(layerFamily => layerFamily.sourceId))];
}

function resolveSceneViewportWidth(scene: Scene): number {
  const canvasWidth = scene.canvas as {
    clientWidth?: number;
    width?: number;
  } | undefined;
  return canvasWidth?.clientWidth ?? canvasWidth?.width ?? 256;
}
