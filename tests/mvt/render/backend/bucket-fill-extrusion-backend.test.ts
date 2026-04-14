import { describe, expect, it } from 'vitest';

describe('bucket-fill-extrusion-backend', () => {
  describe('createBucketFillExtrusionTileHandle', () => {
    it('应该为 fill-extrusion 图层生成 3D Polygon primitive', async () => {
      const {
        Material,
        MaterialAppearance,
        PolygonGeometry,
        Primitive,
        WebMercatorTilingScheme,
      } = await import('cesium');
      const { FillBucketBuilder } = await import('@/mvt/bucket/fill-bucket-builder');
      const { createBucketFillExtrusionTileHandle }
        = await import('@/mvt/render/backend/bucket-fill-extrusion-backend');

      const tilingScheme = new WebMercatorTilingScheme();
      const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);
      const bucketBuilder = new FillBucketBuilder({
        bucketType: 'fill-extrusion',
        extent: 4096,
        familyId: 'source/layer/fill-extrusion/0',
        layerIds: ['building-layer'],
        sourceLayer: 'building',
        tileKey: 'source/0/0/0',
        tileProjection: {
          east: rect.east,
          north: rect.north,
          south: rect.south,
          west: rect.west,
        },
      });

      bucketBuilder.addFeature({
        id: 1,
        loadGeometry: () => [[
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ]],
        properties: {},
        type: 3,
      } as any, 0);

      const bucketTile = {
        buckets: [bucketBuilder.build()],
        byteLength: 0,
        epoch: 1,
        key: 'source/0/0/0',
      };

      const style = {
        version: 8 as const,
        sources: {},
        layers: [
          {
            'id': 'building-layer',
            'paint': {
              'fill-extrusion-base': 12,
              'fill-extrusion-color': '#123456',
              'fill-extrusion-height': 48,
            },
            'source': 'source',
            'source-layer': 'building',
            'type': 'fill-extrusion' as const,
          },
        ],
      };

      const handle = createBucketFillExtrusionTileHandle({
        bucketTile,
        style,
      });

      expect(handle).toBeDefined();
      expect(handle?.collections).toHaveLength(1);

      const collection = handle?.collections[0]?.collection;
      expect(collection).toBeInstanceOf(Primitive);
      if (collection instanceof Primitive) {
        expect(collection.appearance).toBeInstanceOf(MaterialAppearance);
        expect(collection.appearance?.material.type).toBe(Material.ColorType);

        const geometryInstance = Array.isArray(collection.geometryInstances)
          ? collection.geometryInstances[0]
          : collection.geometryInstances;
        expect(geometryInstance).toBeDefined();

        const geometry = geometryInstance?.geometry;
        expect(geometry).toBeInstanceOf(PolygonGeometry);
        if (geometry instanceof PolygonGeometry) {
          const polygonGeometry = geometry as {
            _extrudedHeight?: number;
            _height?: number;
          };

          expect(polygonGeometry._height).toBe(48);
          expect(polygonGeometry._extrudedHeight).toBe(12);
        }
      }
    });
  });
});
