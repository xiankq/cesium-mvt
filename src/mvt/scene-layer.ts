import type { Scene } from 'cesium';
import type { StyleSet } from './style/style-set';
import { PrimitiveCollection } from 'cesium';
import { TileManager } from './source/tile-manager';

export class SceneLayer {
  readonly tileManager = new TileManager();

  private currentFrame = 0;
  private readonly scene: Scene;
  private readonly root: PrimitiveCollection;
  private readonly removePostRenderListener?: () => void;
  private readonly removePreRenderListener?: () => void;
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
  }

  getStyle() {
    return this.styleSet;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.removePreRenderListener?.();
    this.removePostRenderListener?.();
    this.scene.primitives.remove(this.root);
    this.destroyed = true;
  }
}
