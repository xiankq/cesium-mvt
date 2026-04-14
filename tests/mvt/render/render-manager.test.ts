import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ParsedTileResult } from '@/mvt/bucket/bucket-types';
import type { BucketRenderedTileHandle } from '@/mvt/render/bucket-rendered-tile';
import { Cartesian3, LabelCollection, PrimitiveCollection, VerticalOrigin } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { createMockLineBucketTile } from '../../helpers/bucket-helpers';

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
  name: string,
  position: Cartesian3 | Cartesian3[],
  icon?: string,
): ParsedTileResult {
  const positions = Array.isArray(position) ? position : [position];
  return {
    buckets: [createSymbolBucket(positions, name, icon)],
    byteLength: 100,
    epoch: 1,
    key,
  };
}

function createSymbolBucket(positions: Cartesian3[], name: string, icon?: string) {
  return {
    data: {
      featureIds: new Float32Array(positions.map((_, index) => index)),
      positions: new Float64Array(positions.flatMap(position => [position.x, position.y, position.z])),
    },
    featureIndex: {
      byteLength: 200,
      entries: positions.map(() => ({
        id: 7,
        properties: {
          ...(icon ? { icon } : {}),
          name,
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
      labelCount: positions.length,
    },
    type: 'symbol' as const,
  };
}

interface SymbolStyleOverrides {
  iconRotate?: number;
  textAllowOverlap?: boolean;
  textRotate?: number;
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
          ...(overrides.textAllowOverlap !== undefined
            ? {
                'text-allow-overlap': overrides.textAllowOverlap,
              }
            : {}),
          ...(overrides.textRotate !== undefined
            ? {
                'text-rotate': overrides.textRotate,
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
