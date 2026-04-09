import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Scene } from 'cesium';
import type { FeatureCollection, Point } from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { Event, PrimitiveCollection } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneLayer } from '../../src/mvt/scene-layer';
import { listSourceLayers, parseVectorTile } from '../../src/mvt/source/vector-tile';
import { createStyleSet } from '../../src/mvt/style/style-set';

function createSceneStub() {
  return {
    postRender: new Event(),
    preRender: new Event(),
    primitives: new PrimitiveCollection(),
  } as unknown as Scene;
}

function createVectorTileBuffer() {
  const data: FeatureCollection<Point, { name: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          name: 'poi-a',
        },
      },
    ],
  };
  const tileIndex = new GeoJSONVT(data);
  const tile = tileIndex.getTile(0, 0, 0);
  if (!tile) {
    throw new Error('Expected fixture tile to exist.');
  }

  const encoded = fromGeojsonVt({ poi: tile });
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  );
}

describe('scene-layer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconciles source caches when the style changes', () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const firstStyle: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [],
    };
    const secondStyle: StyleSpecification = {
      version: 8,
      sources: {
        labels: {
          type: 'vector',
          tiles: ['https://tiles.example.com/labels/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [],
    };

    sceneLayer.updateStyle(createStyleSet(firstStyle));
    const baseCache = sceneLayer.getSourceCache('base');

    expect(baseCache).toBeDefined();
    expect(baseCache?.isDestroyed()).toBe(false);

    sceneLayer.updateStyle(createStyleSet(secondStyle));

    expect(baseCache?.isDestroyed()).toBe(true);
    expect(sceneLayer.getSourceCache('base')).toBeUndefined();
    expect(sceneLayer.getSourceCache('labels')).toBeDefined();

    sceneLayer.destroy();
  });

  it('compiles layer families and render order from supported style layers', () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
        },
        {
          'id': 'land',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
        {
          'id': 'road',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
        },
      ],
    };

    sceneLayer.updateStyle(createStyleSet(style));

    expect(sceneLayer.getLayerFamilies()).toEqual([
      {
        id: 'base/land/fill/0',
        layerIds: ['land'],
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        id: 'base/road/line/1',
        layerIds: ['road'],
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'line',
      },
    ]);
    expect(sceneLayer.getRenderOrder()).toEqual([
      {
        kind: 'background',
        layerId: 'background',
        order: 0,
        type: 'background',
      },
      {
        familyId: 'base/land/fill/0',
        kind: 'geometry',
        layerId: 'land',
        order: 1,
        sourceId: 'base',
        sourceLayer: 'land',
        type: 'fill',
      },
      {
        familyId: 'base/road/line/1',
        kind: 'geometry',
        layerId: 'road',
        order: 2,
        sourceId: 'base',
        sourceLayer: 'road',
        type: 'line',
      },
    ]);

    sceneLayer.destroy();
  });

  it('invalidates render-tile cache when style changes', () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const firstStyle: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'land',
          'type': 'fill',
          'source': 'base',
          'source-layer': 'land',
        },
      ],
    };
    const secondStyle: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'road',
          'type': 'line',
          'source': 'base',
          'source-layer': 'road',
        },
      ],
    };

    sceneLayer.updateStyle(createStyleSet(firstStyle));
    const firstRenderTile = sceneLayer.getRenderTile('base', 3, 4, 5);

    expect(firstRenderTile).toMatchObject({
      epoch: 1,
      geometryBatches: [
        {
          backend: 'fill',
          familyId: 'base/land/fill/0',
        },
      ],
      key: 'base/3/4/5@1',
    });
    expect(sceneLayer.getRenderTile('base', 3, 4, 5)).toBe(firstRenderTile);

    sceneLayer.updateStyle(createStyleSet(secondStyle));
    const secondRenderTile = sceneLayer.getRenderTile('base', 3, 4, 5);

    expect(secondRenderTile).not.toBe(firstRenderTile);
    expect(secondRenderTile).toMatchObject({
      epoch: 2,
      geometryBatches: [
        {
          backend: 'line',
          familyId: 'base/road/line/0',
        },
      ],
      key: 'base/3/4/5@2',
    });

    sceneLayer.destroy();
  });

  it('creates parsed source caches for vector tiles', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [],
    };
    const tileBuffer = createVectorTileBuffer();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      arrayBuffer: async () => tileBuffer,
      ok: true,
    })));

    sceneLayer.updateStyle(createStyleSet(style));
    const tile = await sceneLayer.getSourceCache('base')?.requestTile({
      level: 0,
      x: 0,
      y: 0,
    });

    expect(tile).toBeDefined();
    expect(tile && listSourceLayers(parseVectorTile(tile))).toEqual(['poi']);

    sceneLayer.destroy();
  });

  it('caches extracted feature tiles until the style epoch changes', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const firstStyle: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi',
          'type': 'circle',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };
    const secondStyle: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://tiles.example.com/base/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          'id': 'poi-line',
          'type': 'line',
          'source': 'base',
          'source-layer': 'poi',
        },
      ],
    };
    const fetchSpy = vi.fn(async () => ({
      arrayBuffer: async () => createVectorTileBuffer(),
      ok: true,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    sceneLayer.updateStyle(createStyleSet(firstStyle));
    const firstBucketTile = await sceneLayer.getBucketTile('base', 0, 0, 0);

    expect(firstBucketTile).toMatchObject({
      epoch: 1,
      buckets: [
        expect.objectContaining({
          type: 'circle',
        }),
      ],
      key: 'base/0/0/0@1',
    });
    expect(await sceneLayer.getBucketTile('base', 0, 0, 0)).toBe(firstBucketTile);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    sceneLayer.updateStyle(createStyleSet(secondStyle));
    const secondBucketTile = await sceneLayer.getBucketTile('base', 0, 0, 0);

    expect(secondBucketTile).not.toBe(firstBucketTile);
    expect(secondBucketTile).toMatchObject({
      epoch: 2,
      buckets: [
        expect.objectContaining({
          type: 'line',
          stats: expect.objectContaining({
            featureCount: 0,
          }),
        }),
      ],
      key: 'base/0/0/0@2',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    sceneLayer.destroy();
  });

  it('tiles geojson sources into feature tiles without an explicit source-layer', async () => {
    const scene = createSceneStub();
    const sceneLayer = new SceneLayer(scene);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                properties: {
                  name: 'poi-a',
                },
              },
            ],
          },
        },
      },
      layers: [
        {
          id: 'poi',
          type: 'circle',
          source: 'places',
        },
      ],
    };

    sceneLayer.updateStyle(createStyleSet(style));
    const bucketTile = await sceneLayer.getBucketTile('places', 0, 0, 0);

    expect(bucketTile).toMatchObject({
      epoch: 1,
      buckets: [
        expect.objectContaining({
          type: 'circle',
          sourceLayer: '_geojson',
        }),
      ],
      key: 'places/0/0/0@1',
    });
    expect(bucketTile.buckets[0]?.featureIndex.entries[0]).toMatchObject({
      properties: {
        name: 'poi-a',
      },
      type: 'point',
    });

    sceneLayer.destroy();
  });
});
