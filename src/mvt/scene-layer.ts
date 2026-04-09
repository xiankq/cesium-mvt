import type { SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import type { StyleSet } from './style/style-set';
import { PrimitiveCollection } from 'cesium';
import { SourceCache } from './source/source-cache';
import { TileManager } from './source/tile-manager';

export class SceneLayer {
  readonly tileManager = new TileManager();

  private currentFrame = 0;
  private readonly scene: Scene;
  private readonly root: PrimitiveCollection;
  private readonly removePostRenderListener?: () => void;
  private readonly removePreRenderListener?: () => void;
  private readonly sourceCaches = new Map<string, SourceCache>();
  private destroyed = false;
  private styleSet?: StyleSet;

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
    this.reconcileSourceCaches(styleSet.style.sources);
  }

  getStyle() {
    return this.styleSet;
  }

  getSourceCache(sourceId: string) {
    return this.sourceCaches.get(sourceId);
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
    this.removePreRenderListener?.();
    this.removePostRenderListener?.();
    this.scene.primitives.remove(this.root);
    this.destroyed = true;
  }

  private reconcileSourceCaches(sources: Record<string, SourceSpecification>) {
    const nextSourceIds = new Set(Object.keys(sources));

    for (const [sourceId, source] of Object.entries(sources)) {
      const sourceCache = this.sourceCaches.get(sourceId);
      if (sourceCache) {
        sourceCache.updateSource(source);
        continue;
      }

      this.sourceCaches.set(sourceId, new SourceCache({
        source,
        sourceId,
      }));
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
