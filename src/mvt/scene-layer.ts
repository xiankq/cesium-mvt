import type { SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import type { FeatureTile } from './render/feature-tile';
import type { RenderEntry } from './render/render-order';
import type { RenderTile } from './render/render-tile';
import type { TileCoordinate } from './source/tile-request';
import type { ParsedTile } from './source/vector-tile';
import type { LayerFamily } from './style/layer-family';
import type { StyleSet } from './style/style-set';
import { PrimitiveCollection } from 'cesium';
import { compileFeatureTile } from './render/feature-tile';
import { createRenderOrder } from './render/render-order';
import { compileRenderTile, createRenderTileKey } from './render/render-tile';
import { GeojsonSourceCache } from './source/geojson-source-cache';
import { SourceCache } from './source/source-cache';
import { TileManager } from './source/tile-manager';
import { loadVectorTile } from './source/vector-tile';
import { createLayerFamilies } from './style/layer-family';

interface ParsedSourceCache {
  readonly sourceType: SourceSpecification['type'];
  destroy: () => void;
  isDestroyed: () => boolean;
  requestTile: (coordinate: TileCoordinate) => Promise<ParsedTile>;
  updateSource: (source: SourceSpecification) => void;
}

export class SceneLayer {
  readonly tileManager = new TileManager();

  private currentFrame = 0;
  private readonly scene: Scene;
  private readonly root: PrimitiveCollection;
  private readonly removePostRenderListener?: () => void;
  private readonly removePreRenderListener?: () => void;
  private readonly sourceCaches = new Map<string, ParsedSourceCache>();
  private destroyed = false;
  private readonly featureTilePromises = new Map<string, Promise<FeatureTile>>();
  private readonly featureTiles = new Map<string, FeatureTile>();
  private layerFamilies: LayerFamily[] = [];
  private readonly renderTiles = new Map<string, RenderTile>();
  private renderOrder: RenderEntry[] = [];
  private styleSet?: StyleSet;
  private styleEpoch = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.root = new PrimitiveCollection();
    this.scene.primitives.add(this.root);
    this.removePreRenderListener = this.scene.preRender?.addEventListener(() => {
      this.currentFrame += 1;
      this.tileManager.beginFrame(this.currentFrame);
    });
    this.removePostRenderListener = this.scene.postRender?.addEventListener(() => {
      this.tileManager.endFrame();
    });
  }

  updateStyle(styleSet: StyleSet) {
    this.styleSet = styleSet;
    this.styleEpoch += 1;
    this.layerFamilies = createLayerFamilies(styleSet.style);
    this.featureTilePromises.clear();
    this.featureTiles.clear();
    this.renderOrder = createRenderOrder(styleSet.style, this.layerFamilies);
    this.renderTiles.clear();
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
    const renderTileKey = `${baseKey}@${this.styleEpoch}`;
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
    const sourceCache = this.sourceCaches.get(sourceId);
    if (!sourceCache) {
      throw new Error(`Source cache not found: ${sourceId}`);
    }

    const renderTile = this.getRenderTile(sourceId, level, x, y);
    const cachedFeatureTile = this.featureTiles.get(renderTile.key);
    if (cachedFeatureTile) {
      return cachedFeatureTile;
    }

    const pendingFeatureTile = this.featureTilePromises.get(renderTile.key);
    if (pendingFeatureTile) {
      return pendingFeatureTile;
    }

    const featureTilePromise = sourceCache.requestTile({
      level,
      x,
      y,
    }).then((tile) => {
      const featureTile = compileFeatureTile({
        renderTile,
        tile,
      });
      this.featureTiles.set(featureTile.key, featureTile);
      return featureTile;
    }).finally(() => {
      this.featureTilePromises.delete(renderTile.key);
    });

    this.featureTilePromises.set(renderTile.key, featureTilePromise);
    return featureTilePromise;
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
