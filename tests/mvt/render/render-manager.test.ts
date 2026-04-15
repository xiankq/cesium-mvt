import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ParsedTileResult } from '@/mvt/bucket/bucket-types';
import type { BucketRenderedTileHandle } from '@/mvt/render/bucket-rendered-tile';
import { BillboardCollection, Cartesian3, LabelCollection, PrimitiveCollection, VerticalOrigin } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { createMockCircleBucketTile, createMockLineBucketTile } from '../../helpers/bucket-helpers';

const ICON_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nqkAAAAASUVORK5CYII=';

describe('render-manager', () => {
  it('destroy 不应该重复销毁已经从 root 移除的 collection', async () => {
    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const bucketTile = createMockLineBucketTile();
    const style = createDashedLineStyle();

    manager.mount('source/0/0/0', bucketTile, style);

    expect(() => {
      manager.destroy();
    }).not.toThrow();
  });

  it('当 root 不负责销毁 primitives 时仍然应该显式销毁 collection', async () => {
    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    root.destroyPrimitives = false;

    const manager = new RenderManager({
      root,
    });
    const bucketTile = createMockLineBucketTile();
    const style = createDashedLineStyle();

    const handle = manager.mount('source/0/0/0', bucketTile, style);
    const collection = handle.collections[0]?.collection;

    manager.destroy();

    expect(collection?.isDestroyed()).toBe(true);
  });

  it('当 root 已经先被销毁时 destroy 不应该再次触发 root 清理', async () => {
    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const bucketTile = createMockLineBucketTile();
    const style = createDashedLineStyle();

    manager.mount('source/0/0/0', bucketTile, style);
    root.destroy();

    expect(() => {
      manager.destroy();
    }).not.toThrow();
  });

  it('当 root 先被销毁且不负责销毁 primitives 时仍然应该显式销毁 collection', async () => {
    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    root.destroyPrimitives = false;

    const manager = new RenderManager({
      root,
    });
    const bucketTile = createMockLineBucketTile();
    const style = createDashedLineStyle();

    const handle = manager.mount('source/0/0/0', bucketTile, style);
    const collection = handle.collections[0]?.collection;

    root.destroy();
    manager.destroy();

    expect(collection?.isDestroyed()).toBe(true);
  });

  it('应该统计 mount hide remove 的生命周期次数', async () => {
    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const bucketTile = createMockLineBucketTile();
    const style = createDashedLineStyle();

    manager.mount('source/0/0/0', bucketTile, style);
    manager.hide('source/0/0/0');
    manager.remove('source/0/0/0');

    expect(manager.getMetrics()).toEqual({
      hideCount: 1,
      mountCount: 1,
      removeCount: 1,
    });
  });

  it('应该只把每个 tile 挂载到 root 一次', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const addSpy = vi.spyOn(root, 'add');
    const removeSpy = vi.spyOn(root, 'remove');
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(true);

    const handle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        Cartesian3.fromDegrees(120, 30, 0),
        ICON_DATA_URI,
      ),
      style,
    );

    expect(handle.collections.length).toBeGreaterThan(1);
    expect(addSpy).toHaveBeenCalledTimes(1);

    manager.destroy();

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshSourceLayer 只应该刷新命中的 sourceLayer 瓦片', async () => {
    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createLayeredCircleStyle();
    const roadsKey = 'source/0/0/0';
    const poiKey = 'source/0/0/1';
    const roadsTile = createMockCircleBucketTile({
      layerId: 'roads',
      sourceName: 'source',
      tileKey: roadsKey,
    });
    const poiTile = createMockCircleBucketTile({
      layerId: 'poi',
      sourceName: 'source',
      tileKey: poiKey,
    });
    (roadsTile.buckets[0] as any).sourceLayer = 'roads';
    (poiTile.buckets[0] as any).sourceLayer = 'poi';

    const roadsHandle = manager.mount(roadsKey, roadsTile, style);
    const poiHandle = manager.mount(poiKey, poiTile, style);
    const refreshSpy = vi.spyOn(manager, 'refresh');

    (manager as any).refreshSourceLayer(
      'source',
      'roads',
      (key: string) => (key === roadsKey ? roadsTile : poiTile),
      style,
    );

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(roadsKey, roadsTile, style, undefined);
    expect(manager.getHandle(roadsKey)).not.toBe(roadsHandle);
    expect(manager.getHandle(poiKey)).toBe(poiHandle);

    manager.destroy();
  });

  it('应该让跨 tile 的相同符号只保留一个实例', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle();

    const firstHandle = manager.mount(
      'source/0/0/0',
      createSymbolBucketTile('source/0/0/0', 'Museum', Cartesian3.fromDegrees(120, 30, 0)),
      style,
    );
    const secondHandle = manager.mount(
      'source/1/0/0',
      createSymbolBucketTile('source/1/0/0', 'Museum', Cartesian3.fromDegrees(120, 30, 0)),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(false);
    expect(secondLabel?.show).toBe(true);

    manager.destroy();
  });

  it('text-allow-overlap 仍然应该挡住后来的普通符号', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const overlapStyle = createSymbolStyle(false, {
      textAllowOverlap: true,
    });
    const normalStyle = createSymbolStyle(false);
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        position,
      ),
      overlapStyle,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'School',
        position,
      ),
      normalStyle,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(false);

    manager.destroy();
  });

  it('text-ignore-placement 不应该挡住后来的普通符号', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      textIgnorePlacement: true,
    });
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        position,
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'School',
        position,
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(true);

    manager.destroy();
  });

  it('text-overlap 为 cooperative 时应允许同类符号重叠', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      textOverlap: 'cooperative',
    });
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        position,
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'School',
        position,
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(true);

    manager.destroy();
  });

  it('icon-allow-overlap 仍然应该挡住后来的普通符号', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const overlapStyle = createIconStyle({
      iconAllowOverlap: true,
    });
    const normalStyle = createIconStyle();
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createIconBucketTile(
        'source/15/0/0',
        position,
      ),
      overlapStyle,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createIconBucketTile(
        'source/15/1/0',
        position,
      ),
      normalStyle,
    );

    const firstBillboard = getBillboard(firstHandle);
    const secondBillboard = getBillboard(secondHandle);

    expect(firstBillboard?.show).toBe(true);
    expect(secondBillboard?.show).toBe(false);

    manager.destroy();
  });

  it('icon-ignore-placement 不应该挡住后来的普通符号', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const ignoreStyle = createIconStyle({
      iconIgnorePlacement: true,
    });
    const normalStyle = createIconStyle();
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createIconBucketTile(
        'source/15/0/0',
        position,
      ),
      ignoreStyle,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createIconBucketTile(
        'source/15/1/0',
        position,
      ),
      normalStyle,
    );

    const firstBillboard = getBillboard(firstHandle);
    const secondBillboard = getBillboard(secondHandle);

    expect(firstBillboard?.show).toBe(true);
    expect(secondBillboard?.show).toBe(true);

    manager.destroy();
  });

  it('icon-overlap 为 cooperative 时应允许同类符号重叠', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createIconStyle({
      iconOverlap: 'cooperative',
    });
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createIconBucketTile(
        'source/15/0/0',
        position,
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createIconBucketTile(
        'source/15/1/0',
        position,
      ),
      style,
    );

    const firstBillboard = getBillboard(firstHandle);
    const secondBillboard = getBillboard(secondHandle);

    expect(firstBillboard?.show).toBe(true);
    expect(secondBillboard?.show).toBe(true);

    manager.destroy();
  });

  it('crossSourceCollisions 关闭时不同 source 的重叠符号不应该互相隐藏', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
      crossSourceCollisions: false,
    });
    const style = createSymbolStyle(false);
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'base/15/0/0',
      createSymbolBucketTile(
        'base/15/0/0',
        'Museum',
        position,
      ),
      style,
    );
    const secondHandle = manager.mount(
      'overlay/15/0/0',
      createSymbolBucketTile(
        'overlay/15/0/0',
        'School',
        position,
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(true);

    manager.destroy();
  });

  it('dense mixed text+icon 点位不应该几乎全灭', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        {
          'id': 'poi-layer',
          'type': 'symbol',
          'source': 'source',
          'source-layer': 'layer',
          'layout': {
            'icon-image': ['get', 'icon'],
            'icon-optional': true,
            'text-field': ['get', 'name'],
            'icon-offset': [0, -10],
            'icon-padding': 0,
            'icon-size': 16,
            'text-offset': [0, 10],
            'text-padding': 0,
            'text-size': 12,
          },
        },
      ],
    };

    const handle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        ['A', 'B', 'C'],
        [
          Cartesian3.fromDegrees(120, 30, 0),
          Cartesian3.fromDegrees(120.0008, 30, 0),
          Cartesian3.fromDegrees(120, 30.0008, 0),
        ],
        ICON_DATA_URI,
      ),
      style,
    );

    const visibleRenderables = countVisibleRenderables(handle);
    expect(visibleRenderables).toBeGreaterThan(2);

    manager.destroy();
  });

  it('symbol-z-order 为 auto 且无法重叠时不应该按 viewport-y 误排', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      textSize: 48,
    });

    const southHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'South',
        Cartesian3.fromDegrees(120, 30, 0),
      ),
      style,
    );
    const northHandle = manager.mount(
      'source/15/0/1',
      createSymbolBucketTile(
        'source/15/0/1',
        'North',
        Cartesian3.fromDegrees(120, 30.0008, 0),
      ),
      style,
    );

    expect(getLabel(southHandle)?.show).toBe(true);
    expect(getLabel(northHandle)?.show).toBe(false);

    manager.destroy();
  });

  it('symbol-z-order 为 viewport-y 时不应该让 data-driven symbol-sort-key 抢占顺序', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      sortKeyExpression: ['get', 'priority'],
      zOrder: 'viewport-y',
    });
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        position,
        undefined,
        ['poi-layer'],
        [{ priority: 10 }],
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'School',
        position,
        undefined,
        ['poi-layer'],
        [{ priority: 1 }],
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(false);

    manager.destroy();
  });

  it('不同 tile 的符号也应该按数据驱动的 symbol-sort-key 优先保留低优先级', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      sortKeyExpression: ['get', 'priority'],
    });
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        position,
        undefined,
        ['poi-layer'],
        [{ priority: 10 }],
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'School',
        position,
        undefined,
        ['poi-layer'],
        [{ priority: 1 }],
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(false);
    expect(secondLabel?.show).toBe(true);

    manager.destroy();
  });

  it('应该让足够接近的同名符号只保留一个实例', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle();

    const firstHandle = manager.mount(
      'source/0/0/0',
      createSymbolBucketTile(
        'source/0/0/0',
        'Museum',
        Cartesian3.fromDegrees(120, 30, 0),
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/0/0/1',
      createSymbolBucketTile(
        'source/0/0/1',
        'Museum',
        Cartesian3.fromDegrees(120.00001, 30, 0),
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(false);

    manager.destroy();
  });

  it('同名但足够远的跨 tile POI 不应该被名字 key 误杀', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        Cartesian3.fromDegrees(120, 30, 0),
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'Museum',
        Cartesian3.fromDegrees(120.01, 30, 0),
      ),
      style,
    );

    expect(getLabel(firstHandle)?.show).toBe(true);
    expect(getLabel(secondHandle)?.show).toBe(true);

    manager.destroy();
  });

  it('应该隐藏同一位置但不同名称的跨 tile 符号', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false);
    const position = Cartesian3.fromDegrees(120, 30, 0);

    const firstHandle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        position,
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/15/1/0',
      createSymbolBucketTile(
        'source/15/1/0',
        'School',
        position,
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect([firstLabel, secondLabel].filter(label => label?.show)).toHaveLength(1);

    manager.destroy();
  });

  it('在更低 zoom 上应该容忍更大的同名符号锚点偏移', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle();

    const firstHandle = manager.mount(
      'source/10/0/0',
      createSymbolBucketTile(
        'source/10/0/0',
        'Museum',
        Cartesian3.fromDegrees(120, 30, 0),
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/8/0/0',
      createSymbolBucketTile(
        'source/8/0/0',
        'Museum',
        Cartesian3.fromDegrees(120.003, 30, 0),
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect(firstLabel?.show).toBe(true);
    expect(secondLabel?.show).toBe(false);

    manager.destroy();
  });

  it('同名文本不应该因为图标不同而重复显示', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(true);

    const firstHandle = manager.mount(
      'source/0/0/0',
      createSymbolBucketTile(
        'source/0/0/0',
        'Museum',
        Cartesian3.fromDegrees(120, 30, 0),
        ICON_DATA_URI,
      ),
      style,
    );
    const secondHandle = manager.mount(
      'source/0/0/1',
      createSymbolBucketTile(
        'source/0/0/1',
        'Museum',
        Cartesian3.fromDegrees(120, 30, 0),
      ),
      style,
    );

    const firstLabel = getLabel(firstHandle);
    const secondLabel = getLabel(secondHandle);

    expect([firstLabel?.show, secondLabel?.show].filter(Boolean)).toHaveLength(1);

    manager.destroy();
  });

  it('默认情况下应该隐藏同名近邻符号的重复渲染', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false);

    const handle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        [
          Cartesian3.fromDegrees(120, 30, 0),
          Cartesian3.fromDegrees(120.0008, 30, 0),
        ],
      ),
      style,
    );

    const labels = getLabels(handle);
    expect(labels.filter(label => label.show)).toHaveLength(1);

    manager.destroy();
  });

  it('text-allow-overlap 应该保留同名近邻符号的重复渲染', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      textAllowOverlap: true,
    });

    const handle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        [
          Cartesian3.fromDegrees(120, 30, 0),
          Cartesian3.fromDegrees(120.0008, 30, 0),
        ],
      ),
      style,
    );

    const labels = getLabels(handle);
    expect(labels.filter(label => label.show)).toHaveLength(2);

    manager.destroy();
  });

  it('text-variable-anchor 应该把同名近邻符号挪到可放置的位置', async () => {
    vi.stubGlobal('document', createDocumentStub());

    const { RenderManager } = await import('@/mvt/render/render-manager');

    const root = new PrimitiveCollection();
    const manager = new RenderManager({
      root,
    });
    const style = createSymbolStyle(false, {
      textVariableAnchor: ['bottom', 'top'],
    });

    const handle = manager.mount(
      'source/15/0/0',
      createSymbolBucketTile(
        'source/15/0/0',
        'Museum',
        [
          Cartesian3.fromDegrees(120, 30, 0),
          Cartesian3.fromDegrees(120, 30.0008, 0),
        ],
      ),
      style,
    );

    const labels = getLabels(handle);
    const visibleLabels = labels.filter(label => label.show);

    expect(visibleLabels).toHaveLength(2);
    expect(visibleLabels[1]?.verticalOrigin).toBe(VerticalOrigin.BOTTOM);

    manager.destroy();
  });
});

function createDashedLineStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'layer1',
        'paint': {
          'line-color': '#00ff00',
          'line-dasharray': ['literal', [2, 1]],
          'line-width': 2,
        },
        'source': 'source',
        'source-layer': 'layer',
        'type': 'line',
      },
    ],
  };
}

function createLayeredCircleStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      source: {
        type: 'vector',
        tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        'id': 'roads',
        'source': 'source',
        'source-layer': 'roads',
        'type': 'circle',
      },
      {
        'id': 'poi',
        'source': 'source',
        'source-layer': 'poi',
        'type': 'circle',
      },
    ],
  };
}

function createDocumentStub() {
  const computedStyle = {
    getPropertyValue(property: string) {
      switch (property) {
        case 'font-family':
          return 'Open Sans Regular';
        case 'font-size':
          return '18px';
        case 'font-style':
          return 'normal';
        case 'font-weight':
          return '400';
        case 'line-height':
          return 'normal';
        default:
          return '';
      }
    },
  };

  return {
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    createElement: vi.fn(() => ({ style: {} })),
    defaultView: {
      getComputedStyle: vi.fn(() => computedStyle),
    },
  };
}

function createSymbolBucketTile(
  key: string,
  name: string | string[],
  position: Cartesian3 | Cartesian3[],
  icon?: string | string[],
  layerIds: string[] = ['poi-layer'],
  properties?: Array<Record<string, unknown>>,
): ParsedTileResult {
  const positions = Array.isArray(position) ? position : [position];
  return {
    buckets: [createSymbolBucket(positions, name, icon, layerIds, properties)],
    byteLength: 100,
    epoch: 1,
    key,
  };
}

function createSymbolBucket(
  positions: Cartesian3[],
  name: string | string[],
  icon?: string | string[],
  layerIds: string[] = ['poi-layer'],
  properties?: Array<Record<string, unknown>>,
) {
  const names = Array.isArray(name) ? name : positions.map(() => name);
  const icons = Array.isArray(icon) ? icon : positions.map(() => icon);
  return {
    data: {
      featureIds: new Float32Array(positions.map((_, index) => index)),
      positions: new Float64Array(positions.flatMap(position => [position.x, position.y, position.z])),
    },
    featureIndex: {
      byteLength: 200,
      entries: positions.map((_, index) => ({
        id: 7 + index,
        properties: {
          ...(properties?.[index] ?? {}),
          ...(icons[index] ? { icon: icons[index] } : {}),
          name: names[index] ?? names[names.length - 1] ?? '',
        },
        type: 'point' as const,
      })),
    },
    familyId: 'source/layer/symbol/0',
    layerIds,
    sourceLayer: 'layer',
    stats: {
      type: 'symbol' as const,
      billboardCount: 0,
      byteLength: 100,
      featureCount: positions.length,
      labelCount: positions.length,
    },
    type: 'symbol' as const,
  };
}

interface SymbolStyleOverrides {
  iconAllowOverlap?: boolean;
  iconAnchor?: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  iconIgnorePlacement?: boolean;
  iconOverlap?: 'always' | 'cooperative' | 'never';
  iconRotate?: number;
  iconOffset?: [number, number];
  iconSize?: number;
  sortKey?: number;
  sortKeyExpression?: unknown;
  zOrder?: 'auto' | 'source' | 'viewport-y';
  textAllowOverlap?: boolean;
  textAnchor?: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  textIgnorePlacement?: boolean;
  textOverlap?: 'always' | 'cooperative' | 'never';
  textOffset?: [number, number];
  textRotate?: number;
  textSize?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase';
  textVariableAnchor?: Array<'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>;
}

function createSymbolStyle(
  withIcon = false,
  overrides: SymbolStyleOverrides = {},
): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'poi-layer',
        'type': 'symbol',
        'source': 'source',
        'source-layer': 'layer',
        'layout': {
          ...(withIcon
            ? {
                'icon-image': ['get', 'icon'],
              }
            : {}),
          ...(overrides.iconRotate !== undefined
            ? {
                'icon-rotate': overrides.iconRotate,
              }
            : {}),
          ...(overrides.iconOffset !== undefined
            ? {
                'icon-offset': overrides.iconOffset,
              }
            : {}),
          ...(overrides.iconSize !== undefined
            ? {
                'icon-size': overrides.iconSize,
              }
            : {}),
          ...(overrides.sortKeyExpression !== undefined
            ? {
                'symbol-sort-key': overrides.sortKeyExpression as any,
              }
            : overrides.sortKey !== undefined
              ? {
                  'symbol-sort-key': overrides.sortKey,
                }
              : {}),
          ...(overrides.zOrder !== undefined
            ? {
                'symbol-z-order': overrides.zOrder,
              }
            : {}),
          ...(overrides.textAllowOverlap !== undefined
            ? {
                'text-allow-overlap': overrides.textAllowOverlap,
              }
            : {}),
          ...(overrides.textIgnorePlacement !== undefined
            ? {
                'text-ignore-placement': overrides.textIgnorePlacement,
              }
            : {}),
          ...(overrides.textOverlap !== undefined
            ? {
                'text-overlap': overrides.textOverlap,
              }
            : {}),
          ...(overrides.textRotate !== undefined
            ? {
                'text-rotate': overrides.textRotate,
              }
            : {}),
          ...(overrides.textOffset !== undefined
            ? {
                'text-offset': overrides.textOffset,
              }
            : {}),
          ...(overrides.textSize !== undefined
            ? {
                'text-size': overrides.textSize,
              }
            : {}),
          ...(overrides.textVariableAnchor !== undefined
            ? {
                'text-variable-anchor': overrides.textVariableAnchor,
              }
            : {}),
          ...(overrides.textTransform !== undefined
            ? {
                'text-transform': overrides.textTransform,
              }
            : {}),
          'text-field': ['get', 'name'],
        },
      },
    ],
  };
}

function createIconStyle(overrides: SymbolStyleOverrides = {}): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'poi-layer',
        'type': 'symbol',
        'source': 'source',
        'source-layer': 'layer',
        'layout': {
          'icon-image': ['get', 'icon'],
          ...(overrides.iconAllowOverlap !== undefined
            ? {
                'icon-allow-overlap': overrides.iconAllowOverlap,
              }
            : {}),
          ...(overrides.iconIgnorePlacement !== undefined
            ? {
                'icon-ignore-placement': overrides.iconIgnorePlacement,
              }
            : {}),
          ...(overrides.iconOverlap !== undefined
            ? {
                'icon-overlap': overrides.iconOverlap,
              }
            : {}),
        },
      },
    ],
  };
}

function getLabel(handle: BucketRenderedTileHandle) {
  for (const entry of handle.symbols?.collections ?? []) {
    if (entry.collection instanceof LabelCollection) {
      return entry.collection.get(0);
    }
  }

  return undefined;
}

function getLabels(handle: BucketRenderedTileHandle) {
  for (const entry of handle.symbols?.collections ?? []) {
    if (entry.collection instanceof LabelCollection) {
      const collection = entry.collection as LabelCollection;
      return Array.from({ length: entry.itemCount }, (_, index) => collection.get(index));
    }
  }

  return [];
}

function getBillboard(handle: BucketRenderedTileHandle) {
  for (const entry of handle.symbols?.collections ?? []) {
    if (entry.collection instanceof BillboardCollection) {
      return entry.collection.get(0);
    }
  }

  return undefined;
}

function getBillboards(handle: BucketRenderedTileHandle) {
  for (const entry of handle.symbols?.collections ?? []) {
    if (entry.collection instanceof BillboardCollection) {
      const collection = entry.collection as BillboardCollection;
      return Array.from({ length: entry.itemCount }, (_, index) => collection.get(index));
    }
  }

  return [];
}

function countVisibleRenderables(handle: BucketRenderedTileHandle) {
  const labels = getLabels(handle);
  const billboards = getBillboards(handle);
  return [...labels, ...billboards].filter(item => item.show).length;
}

function createIconBucketTile(
  key: string,
  position: Cartesian3 | Cartesian3[],
): ParsedTileResult {
  const positions = Array.isArray(position) ? position : [position];
  return {
    buckets: [createIconBucket(positions)],
    byteLength: 100,
    epoch: 1,
    key,
  };
}

function createIconBucket(positions: Cartesian3[]) {
  return {
    data: {
      featureIds: new Float32Array(positions.map((_, index) => index)),
      positions: new Float64Array(positions.flatMap(p => [p.x, p.y, p.z])),
    },
    featureIndex: {
      byteLength: 200,
      entries: positions.map((_, index) => ({
        id: 7 + index,
        properties: {
          icon: ICON_DATA_URI,
        },
        type: 'point' as const,
      })),
    },
    familyId: 'source/layer/symbol/0',
    layerIds: ['poi-layer'],
    sourceLayer: 'layer',
    stats: {
      type: 'symbol' as const,
      billboardCount: 0,
      byteLength: 100,
      featureCount: positions.length,
      labelCount: 0,
    },
    type: 'symbol' as const,
  };
}
