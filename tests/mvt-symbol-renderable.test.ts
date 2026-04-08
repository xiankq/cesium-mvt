import { LabelCollection, WebMercatorTilingScheme } from '@cesium/engine';
import { describe, expect, it, vi } from 'vitest';
import { parseMvtVectorTile } from '../src/mvt/parse/mvt-vector-tile-parser';
import { MvtSymbolCollisionIndex } from '../src/mvt/render/mvt-symbol-collision';
import { createMvtTileRenderBundle } from '../src/mvt/render/mvt-tile-render-bundle';
import { createTestLocalMvtArrayBuffer, createTestMvtArrayBuffer } from './mvt-test-tile';
import { loadOpenFreeMapBrightStyleSet } from './openfreemap-bright-style';

describe('mvt-symbol-renderable', () => {
  it('renders text symbols from openfreemap bright style into Cesium label collections', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestMvtArrayBuffer({
      water_name: {
        features: [
          {
            geometry: {
              coordinates: [4, 4],
              type: 'Point',
            },
            properties: {
              name: '太湖',
              name_en: 'Taihu Lake',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    const parsedTile = parseMvtVectorTile(tileBuffer, styleSet, 14);
    expect(parsedTile.buckets.some(bucket => bucket.type === 'symbol')).toBe(true);

    const renderBundle = createMvtTileRenderBundle({
      coordinate: { x: 13423, y: 6452, z: 14 },
      parsedTileData: parsedTile,
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    expect(renderBundle.byteLength).toBeGreaterThan(0);
    expect(renderBundle.isDestroyed()).toBe(false);
    renderBundle.destroy();
    expect(renderBundle.isDestroyed()).toBe(true);
  }, 15000);

  it('renders sprite-backed icon symbols from openfreemap bright style', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const tileBuffer = createTestMvtArrayBuffer({
      transportation: {
        features: [
          {
            geometry: {
              coordinates: [[0, 4], [8, 4], [16, 4], [24, 4]],
              type: 'LineString',
            },
            properties: {
              class: 'motorway',
              oneway: 1,
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    const parsedTile = parseMvtVectorTile(tileBuffer, styleSet, 16);
    expect(parsedTile.buckets.some(bucket => bucket.type === 'symbol')).toBe(true);

    const renderBundle = createMvtTileRenderBundle({
      coordinate: { x: 3355, y: 1613, z: 16 },
      parsedTileData: parsedTile,
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    expect(styleSet.spriteAtlas?.entries.has('oneway')).toBe(true);
    expect(renderBundle.byteLength).toBeGreaterThan(0);

    renderBundle.destroy();
    expect(renderBundle.isDestroyed()).toBe(true);
  }, 15000);

  it('collapses overlapping duplicate point labels within the same tile', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const coordinate = { x: 13423, y: 6452, z: 14 };
    const addedLabels: Array<{ show: boolean; text?: string }> = [];
    const originalAdd = LabelCollection.prototype.add;
    const addSpy = vi.spyOn(LabelCollection.prototype, 'add').mockImplementation(function (...args) {
      const label = originalAdd.apply(this, args);
      addedLabels.push(label as { show: boolean; text?: string });
      return label;
    });
    const duplicateFeatureTileBuffer = createTestMvtArrayBuffer({
      water_name: {
        features: [
          {
            geometry: {
              coordinates: [4, 4],
              type: 'Point',
            },
            properties: {
              name: '重复标签',
            },
            type: 'Feature',
          },
          {
            geometry: {
              coordinates: [4, 4],
              type: 'Point',
            },
            properties: {
              name: '重复标签',
            },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      },
    });

    const duplicateRenderBundle = createMvtTileRenderBundle({
      coordinate,
      parsedTileData: parseMvtVectorTile(duplicateFeatureTileBuffer, styleSet, coordinate.z),
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    duplicateRenderBundle.update({}, coordinate.z, new MvtSymbolCollisionIndex());
    const visibleLabels = addedLabels.filter(label => label.show && label.text === '重复标签');
    expect(visibleLabels).toHaveLength(1);

    addSpy.mockRestore();
    duplicateRenderBundle.destroy();
  });

  it('renders stacked multilingual point labels as centered multiline text', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const addSpy = vi.spyOn(LabelCollection.prototype, 'add');
    const renderBundle = createMvtTileRenderBundle({
      coordinate: { x: 13423, y: 6452, z: 14 },
      parsedTileData: parseMvtVectorTile(createTestMvtArrayBuffer({
        water_name: {
          features: [
            {
              geometry: {
                coordinates: [4, 4],
                type: 'Point',
              },
              properties: {
                'name:latin': 'Taihu Lake',
                'name:nonlatin': '太湖',
              },
              type: 'Feature',
            },
          ],
          type: 'FeatureCollection',
        },
      }), styleSet, 14),
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    const labelCalls = addSpy.mock.calls.map(call => call[0]).filter(options => options.text);
    expect(labelCalls).toHaveLength(2);
    expect(labelCalls[0].text).toBe('Taihu Lake');
    expect(labelCalls[1].text).toBe('太湖');
    expect(labelCalls[0].horizontalOrigin).toBe(labelCalls[1].horizontalOrigin);
    expect(labelCalls[0].pixelOffset.y).toBeGreaterThan(labelCalls[1].pixelOffset.y);

    renderBundle.update({}, 14, new MvtSymbolCollisionIndex());
    renderBundle.update({}, 14, new MvtSymbolCollisionIndex());
    expect(addSpy.mock.calls).toHaveLength(2);

    renderBundle.destroy();
    addSpy.mockRestore();
  });

  it('shares collision hiding across neighboring tiles in the same frame', async () => {
    const styleSet = await loadOpenFreeMapBrightStyleSet();
    const addedLabels: Array<{ show: boolean; text?: string }> = [];
    const addSpy = vi.spyOn(LabelCollection.prototype, 'add').mockImplementation((options) => {
      const label = { show: true, text: options?.text } as { show: boolean; text?: string };
      addedLabels.push(label);
      return label as unknown as ReturnType<LabelCollection['add']>;
    });
    const sharedCollisionIndex = new MvtSymbolCollisionIndex();
    const leftBundle = createMvtTileRenderBundle({
      coordinate: { x: 100, y: 100, z: 8 },
      parsedTileData: parseMvtVectorTile(createTestLocalMvtArrayBuffer({
        water_name: {
          features: [{
            geometry: {
              coordinates: [4095.5, 2048],
              type: 'Point',
            },
            properties: {
              name: '边界标签',
            },
          }],
        },
      }), styleSet, 8),
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });
    const rightBundle = createMvtTileRenderBundle({
      coordinate: { x: 101, y: 100, z: 8 },
      parsedTileData: parseMvtVectorTile(createTestLocalMvtArrayBuffer({
        water_name: {
          features: [{
            geometry: {
              coordinates: [0.5, 2048],
              type: 'Point',
            },
            properties: {
              name: '边界标签',
            },
          }],
        },
      }), styleSet, 8),
      styleSet,
      tilingScheme: new WebMercatorTilingScheme(),
    });

    leftBundle.update({}, 8, sharedCollisionIndex);
    rightBundle.update({}, 8, sharedCollisionIndex);

    const visibleLabels = addedLabels.filter(label => label.show && label.text === '边界标签');
    expect(visibleLabels).toHaveLength(1);

    rightBundle.destroy();
    leftBundle.destroy();
    addSpy.mockRestore();
  });
});
