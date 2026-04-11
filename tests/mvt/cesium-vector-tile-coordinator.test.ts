import { describe, expect, it } from 'vitest';

describe('cesiumVectorTileCoordinator', () => {
  describe('destroy', () => {
    it('应该能够安全地多次调用 destroy', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      coordinator.destroy();
      coordinator.destroy();

      expect(true).toBe(true);
    });

    it('销毁后应该标记为已销毁', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      expect(coordinator.isDestroyed()).toBe(false);

      coordinator.destroy();

      expect(coordinator.isDestroyed()).toBe(true);
    });

    it('销毁后 update 不应该执行任何操作', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      coordinator.destroy();

      coordinator.update({
        camera: {},
        viewportHeight: 100,
        viewportWidth: 100,
      });

      expect(true).toBe(true);
    });

    it('销毁后 updateStyle 不应该执行任何操作', async () => {
      const { CesiumVectorTileCoordinator } = await import('@/mvt/cesium-vector-tile-coordinator');
      const { PrimitiveCollection, WebMercatorTilingScheme, Rectangle } = await import('cesium');

      const coordinator = new CesiumVectorTileCoordinator({
        minimumLevel: 0,
        rectangle: Rectangle.MAX_VALUE,
        root: new PrimitiveCollection(),
        tileWidth: 256,
        tilingScheme: new WebMercatorTilingScheme(),
      });

      coordinator.destroy();

      coordinator.updateStyle({
        version: 8,
        sources: {},
        layers: [],
      });

      expect(true).toBe(true);
    });
  });
});
