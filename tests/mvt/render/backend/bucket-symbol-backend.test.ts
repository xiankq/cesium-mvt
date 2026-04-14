import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { BillboardCollection, Cartesian2, HorizontalOrigin, LabelCollection, VerticalOrigin, WebMercatorTilingScheme } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SymbolBucketBuilder } from '@/mvt/bucket/symbol-bucket-builder';
import { createBucketSymbolTileHandle, resolveSymbolRenderDecision } from '@/mvt/render/backend/bucket-symbol-backend';

const ICON_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nqkAAAAASUVORK5CYII=';

describe('bucket-symbol-backend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('应该为文本和图标分别创建渲染集合', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createSymbolBucketTile();
    const style = createSymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();
    expect(handle?.byteLength).toBe(200);

    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    const billboardHandle = handle!.collections.find(entry => entry.collection instanceof BillboardCollection);

    expect(labelHandle).toBeDefined();
    expect(billboardHandle).toBeDefined();
    expect(labelHandle?.itemCount).toBe(1);
    expect(billboardHandle?.itemCount).toBe(1);

    const labelCollection = labelHandle!.collection as LabelCollection;
    const billboardCollection = billboardHandle!.collection as BillboardCollection;

    const label = labelCollection.get(0);
    expect(label.text).toBe('Museum');
    expect(label.font).toBe('18px sans-serif');
    expect(label.outlineWidth).toBe(0);
    expect(label.fillColor.red).toBeCloseTo(0x11 / 255, 4);
    expect(label.fillColor.green).toBeCloseTo(0x22 / 255, 4);
    expect(label.fillColor.blue).toBeCloseTo(0x33 / 255, 4);
    expect(label.fillColor.alpha).toBeCloseTo(0.5, 4);
    expect(label.pixelOffset).toEqual(new Cartesian2(6, 4));
    expect(label.horizontalOrigin).toBe(HorizontalOrigin.LEFT);
    expect(label.verticalOrigin).toBe(VerticalOrigin.TOP);

    const billboard = billboardCollection.get(0);
    expect(billboard.image).toBe(ICON_DATA_URI);
    expect(billboard.scale).toBe(1.5);
    expect(billboard.color.red).toBeCloseTo(0x44 / 255, 4);
    expect(billboard.color.green).toBeCloseTo(0x55 / 255, 4);
    expect(billboard.color.blue).toBeCloseTo(0x66 / 255, 4);
    expect(billboard.color.alpha).toBeCloseTo(0.25, 4);
    expect(billboard.pixelOffset).toEqual(new Cartesian2(8, -6));
    expect(billboard.horizontalOrigin).toBe(HorizontalOrigin.RIGHT);
    expect(billboard.verticalOrigin).toBe(VerticalOrigin.BOTTOM);
  });

  it('应该把 formatted 的文本和图片片段分别渲染成独立 primitive', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createSymbolBucketTile();
    const style = {
      version: 8,
      sources: {},
      spriteAtlas: {
        getImage: vi.fn((name: string) => {
          if (name !== 'museum-icon') {
            return undefined;
          }

          return {
            height: 1,
            image: ICON_DATA_URI,
            pixelRatio: 1,
            width: 1,
          };
        }),
      },
      layers: [
        {
          'id': 'poi-layer',
          'type': 'symbol',
          'source': 'source',
          'source-layer': 'layer',
          'layout': {
            'icon-image': ['image', 'museum-icon'],
            'text-field': [
              'format',
              ['get', 'name'],
              {
                'font-scale': 1.5,
                'text-color': '#112233',
                'text-font': ['literal', ['Open Sans Regular', 'Arial Unicode MS Regular']],
              },
              ' ',
              ['image', 'museum-icon'],
              ' Guide',
            ],
            'text-size': 18,
          },
        },
      ],
    } as StyleSpecification;

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style: style as StyleSpecification & {
        spriteAtlas: {
          getImage: (name: string) => {
            height: number;
            image: string;
            pixelRatio: number;
            width: number;
          } | undefined;
        };
      },
    });

    expect(handle).toBeDefined();
    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    const billboardHandle = handle!.collections.find(entry => entry.collection instanceof BillboardCollection);
    expect(labelHandle).toBeDefined();
    expect(billboardHandle).toBeDefined();
    expect(labelHandle?.itemCount).toBe(2);
    expect(billboardHandle?.itemCount).toBe(2);

    const labelCollection = labelHandle!.collection as LabelCollection;
    const billboardCollection = billboardHandle!.collection as BillboardCollection;

    const firstLabel = labelCollection.get(0);
    expect(firstLabel.text).toBe('Museum');
    expect(firstLabel.font).toBe('27px Open Sans Regular,Arial Unicode MS Regular');
    expect(firstLabel.fillColor.red).toBeCloseTo(0x11 / 255, 4);
    expect(firstLabel.fillColor.green).toBeCloseTo(0x22 / 255, 4);
    expect(firstLabel.fillColor.blue).toBeCloseTo(0x33 / 255, 4);
    expect(firstLabel.fillColor.alpha).toBeCloseTo(1, 4);

    const secondLabel = labelCollection.get(1);
    expect(secondLabel.text).toBe('Guide');
    expect(secondLabel.font).toBe('18px sans-serif');
    expect(secondLabel.fillColor.red).toBeCloseTo(0, 4);
    expect(secondLabel.fillColor.green).toBeCloseTo(0, 4);
    expect(secondLabel.fillColor.blue).toBeCloseTo(0, 4);
    expect(secondLabel.fillColor.alpha).toBeCloseTo(1, 4);

    const firstBillboard = billboardCollection.get(0);
    const secondBillboard = billboardCollection.get(1);
    expect(firstBillboard.image).toBe(ICON_DATA_URI);
    expect(secondBillboard.image).toBe(ICON_DATA_URI);
  });

  it('应该按照 symbol-sort-key 排序同层符号', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createSortedSymbolBucketTile();
    const style = createSortedSymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();
    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    expect(labelHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    expect(labelCollection.get(0).text).toBe('North');
    expect(labelCollection.get(1).text).toBe('South');
  });

  it('应该让同 tile 的不同 symbol layer 共享碰撞隐藏', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createCrossLayerSymbolBucketTile();
    const style = createCrossLayerSymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();

    const labelCollections = handle!.collections
      .filter(entry => entry.collection instanceof LabelCollection)
      .map(entry => entry.collection as LabelCollection);

    expect(handle?.placements).toHaveLength(1);
    expect(labelCollections).toHaveLength(1);
    expect(labelCollections[0]?.get(0).show).toBe(true);
  });

  it('应该在 auto symbol-z-order 下按视口 y 排序同层符号', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createSortedSymbolBucketTile();
    const style = createAutoSortedSymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();
    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    expect(labelHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    expect(labelCollection.get(0).text).toBe('North');
    expect(labelCollection.get(1).text).toBe('South');
  });

  it('应该按 text-max-width 自动换行并应用 text-line-height', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createTextOnlyBucketTile('cat dog');
    const style = createTextOnlySymbolStyle({
      textLineHeight: 1.5,
      textMaxWidth: 4,
      textSize: 10,
    });

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();
    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    expect(labelHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    const label = labelCollection.get(0);
    expect(label.text).toBe('cat\ndog');
    expect(label.font).toBe('10px/1.5 sans-serif');
  });

  it('应该在 symbol-avoid-edges 开启时跳过贴边文本', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createTextOnlyBucketTile('Edge', { x: 0, y: 0 });
    const style = createTextOnlySymbolStyle({
      symbolAvoidEdges: true,
    });

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeUndefined();
  });

  it('应该在 text-max-angle 过小时跳过急转弯 line 文本', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createCurvedLineBucketTile('Turn');
    const style = createTextOnlySymbolStyle({
      textMaxAngle: 20,
    });

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeUndefined();
  });

  it('应该在 text-max-angle 过小时跳过靠近转角的 line-center 文本', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createCurvedLineBucketTile(
      'Turn',
      [
        { x: 0, y: 0 },
        { x: 250, y: 0 },
        { x: 250, y: 300 },
      ],
    );
    const style = createTextOnlySymbolStyle({
      textMaxAngle: 20,
    });

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeUndefined();
  });

  it('应该默认保持 label 和 billboard 的深度测试开启', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createSymbolBucketTile();
    const style = createSymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();

    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    const billboardHandle = handle!.collections.find(entry => entry.collection instanceof BillboardCollection);
    expect(labelHandle).toBeDefined();
    expect(billboardHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    const billboardCollection = billboardHandle!.collection as BillboardCollection;

    expect(labelCollection.get(0).disableDepthTestDistance).toBe(0);
    expect(billboardCollection.get(0).disableDepthTestDistance).toBe(0);
  });

  it('应该默认让 label 和 billboard 的纵轴底部对齐', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createSymbolBucketTile();
    const style = {
      version: 8 as const,
      sources: {},
      layers: [
        {
          'id': 'poi-layer',
          'type': 'symbol',
          'source': 'source',
          'source-layer': 'layer',
          'layout': {
            'icon-image': ['get', 'icon'],
            'text-field': ['get', 'name'],
          },
        },
      ],
    } as StyleSpecification;

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();

    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    const billboardHandle = handle!.collections.find(entry => entry.collection instanceof BillboardCollection);
    expect(labelHandle).toBeDefined();
    expect(billboardHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    const billboardCollection = billboardHandle!.collection as BillboardCollection;

    expect(labelCollection.get(0).verticalOrigin).toBe(VerticalOrigin.BOTTOM);
    expect(billboardCollection.get(0).verticalOrigin).toBe(VerticalOrigin.BOTTOM);
  });

  it('text-optional 开启时，文本缺失后仍应该保留图标', () => {
    const decision = resolveSymbolRenderDecision(
      {
        iconOptional: false,
        textField: 'Museum',
        textOptional: true,
      } as any,
      undefined,
      {},
      {
        height: 1,
        image: 'data:image/png;base64,icon',
        pixelRatio: 1,
        width: 1,
      } as any,
    );

    expect(decision).toEqual({
      shouldRenderIcon: true,
      shouldRenderText: false,
    });
  });

  it('icon-optional 开启时，图标缺失后仍应该保留文本', () => {
    const decision = resolveSymbolRenderDecision(
      {
        iconOptional: true,
        textField: 'Museum',
        textOptional: false,
      } as any,
      {},
      undefined,
      {
        height: 1,
        image: 'data:image/png;base64,icon',
        pixelRatio: 1,
        width: 1,
      } as any,
    );

    expect(decision).toEqual({
      shouldRenderIcon: false,
      shouldRenderText: true,
    });
  });

  it('不应该把没有可见内容的 symbol 位置写入 placements', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createMixedSymbolBucketTile();
    const style = createSymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();
    expect(handle?.placements).toHaveLength(1);
    expect(handle?.collections.find(entry => entry.collection instanceof LabelCollection)?.itemCount).toBe(1);
  });

  it('图标缺失时仍然应该渲染文本', () => {
    vi.stubGlobal('document', createDocumentStub());

    const bucketTile = createTextOnlyBucketTile();
    const style = createTextOnlySymbolStyle();

    const handle = createBucketSymbolTileHandle({
      bucketTile,
      style,
    });

    expect(handle).toBeDefined();
    expect(handle?.collections).toHaveLength(1);
    expect(handle?.collections[0]?.collection).toBeInstanceOf(LabelCollection);
    expect(handle?.collections[0]?.itemCount).toBe(1);
    expect(handle?.placements).toHaveLength(1);
    expect(handle?.collections.some(entry => entry.collection instanceof BillboardCollection)).toBe(false);
  });

  it('同名文本的 placement key 不应该因为图标不同而变化', () => {
    vi.stubGlobal('document', createDocumentStub());

    const withIconHandle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile(),
      style: createSymbolStyle(),
    });
    const textOnlyHandle = createBucketSymbolTileHandle({
      bucketTile: createTextOnlyBucketTile('Museum'),
      style: createTextOnlySymbolStyle(),
    });

    expect(withIconHandle?.placements[0]?.key).toBe(textOnlyHandle?.placements[0]?.key);
  });

  it('应该应用 text-transform 和 rotation', () => {
    vi.stubGlobal('document', createDocumentStub());

    const transformedHandle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Museum'),
      style: createSymbolStyle(true, {
        iconRotate: 90,
        textRotate: 45,
        textTransform: 'uppercase',
      }),
    });
    const plainHandle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Museum'),
      style: createSymbolStyle(true),
    });

    expect(transformedHandle?.placements[0]?.key).not.toBe(plainHandle?.placements[0]?.key);

    const labelHandle = transformedHandle!.collections.find(entry => entry.collection instanceof LabelCollection);
    const billboardHandle = transformedHandle!.collections.find(entry => entry.collection instanceof BillboardCollection);

    expect(labelHandle).toBeDefined();
    expect(billboardHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    const billboardCollection = billboardHandle!.collection as BillboardCollection;

    expect(labelCollection.get(0).text).toBe('MUSEUM');
    expect(billboardCollection.get(0).rotation).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('应该应用文本 halo', () => {
    vi.stubGlobal('document', createDocumentStub());

    const handle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Museum'),
      style: createSymbolStyle(true, {
        textHaloBlur: 1,
        textHaloColor: '#abcdef',
        textHaloWidth: 2,
      }),
    });

    expect(handle).toBeDefined();

    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    expect(labelHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    const label = labelCollection.get(0);
    expect(label.outlineColor.red).toBeCloseTo(0xAB / 255, 4);
    expect(label.outlineColor.green).toBeCloseTo(0xCD / 255, 4);
    expect(label.outlineColor.blue).toBeCloseTo(0xEF / 255, 4);
    expect(label.outlineColor.alpha).toBeCloseTo(1, 4);
    expect(label.outlineWidth).toBeCloseTo(3, 4);
  });

  it('应该让图标按文本盒子缩放', () => {
    vi.stubGlobal('document', createDocumentStub());

    const handle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Museum'),
      style: createSymbolStyle(true, {
        iconTextFit: 'both',
        iconTextFitPadding: [1, 2, 3, 4],
        iconSize: 1.5,
      }),
    });

    expect(handle).toBeDefined();

    const billboardHandle = handle!.collections.find(entry => entry.collection instanceof BillboardCollection);
    expect(billboardHandle).toBeDefined();

    const billboardCollection = billboardHandle!.collection as BillboardCollection;
    const billboard = billboardCollection.get(0);
    expect(billboard.scale).toBe(1);
  });

  it('应该合并 text 和 icon 的 offset 与 translate', () => {
    vi.stubGlobal('document', createDocumentStub());

    const handle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Museum'),
      style: createSymbolStyle(true, {
        iconTranslate: [5, 4],
        textTranslate: [3, -2],
      }),
    });

    expect(handle).toBeDefined();

    const labelHandle = handle!.collections.find(entry => entry.collection instanceof LabelCollection);
    const billboardHandle = handle!.collections.find(entry => entry.collection instanceof BillboardCollection);
    expect(labelHandle).toBeDefined();
    expect(billboardHandle).toBeDefined();

    const labelCollection = labelHandle!.collection as LabelCollection;
    const billboardCollection = billboardHandle!.collection as BillboardCollection;

    expect(labelCollection.get(0).pixelOffset).toEqual(new Cartesian2(9, 2));
    expect(billboardCollection.get(0).pixelOffset).toEqual(new Cartesian2(13, -2));
  });

  it('应该把 map translate-anchor 作用到世界位置而不是屏幕偏移', () => {
    vi.stubGlobal('document', createDocumentStub());

    const baseHandle = createBucketSymbolTileHandle({
      bucketTile: createTextOnlyBucketTile('Library'),
      style: createTextOnlySymbolStyle(),
    });
    const mapHandle = createBucketSymbolTileHandle({
      bucketTile: createTextOnlyBucketTile('Library'),
      style: createTextOnlySymbolStyle({
        textTranslate: [12, -8],
        textTranslateAnchor: 'map',
      }),
    });
    const viewportHandle = createBucketSymbolTileHandle({
      bucketTile: createTextOnlyBucketTile('Library'),
      style: createTextOnlySymbolStyle({
        textTranslate: [12, -8],
        textTranslateAnchor: 'viewport',
      }),
    });

    expect(baseHandle).toBeDefined();
    expect(mapHandle).toBeDefined();
    expect(viewportHandle).toBeDefined();

    const baseLabel = baseHandle!.collections.find(entry => entry.collection instanceof LabelCollection)!.collection as LabelCollection;
    const mapLabel = mapHandle!.collections.find(entry => entry.collection instanceof LabelCollection)!.collection as LabelCollection;
    const viewportLabel = viewportHandle!.collections.find(entry => entry.collection instanceof LabelCollection)!.collection as LabelCollection;

    expect(mapLabel.get(0).pixelOffset).toEqual(baseLabel.get(0).pixelOffset);
    expect(viewportLabel.get(0).pixelOffset).not.toEqual(baseLabel.get(0).pixelOffset);
    expect(viewportLabel.get(0).position).toEqual(baseLabel.get(0).position);
    expect(mapLabel.get(0).position).not.toEqual(baseLabel.get(0).position);
  });

  it('应该把 icon map translate-anchor 作用到世界位置而不是屏幕偏移', () => {
    vi.stubGlobal('document', createDocumentStub());

    const baseHandle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Library'),
      style: createSymbolStyle(),
    });
    const mapHandle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Library'),
      style: createSymbolStyle(true, {
        iconTranslate: [12, -8],
        iconTranslateAnchor: 'map',
      }),
    });
    const viewportHandle = createBucketSymbolTileHandle({
      bucketTile: createSymbolBucketTile('Library'),
      style: createSymbolStyle(true, {
        iconTranslate: [12, -8],
        iconTranslateAnchor: 'viewport',
      }),
    });

    expect(baseHandle).toBeDefined();
    expect(mapHandle).toBeDefined();
    expect(viewportHandle).toBeDefined();

    const baseBillboard = baseHandle!.collections.find(entry => entry.collection instanceof BillboardCollection)!.collection as BillboardCollection;
    const mapBillboard = mapHandle!.collections.find(entry => entry.collection instanceof BillboardCollection)!.collection as BillboardCollection;
    const viewportBillboard = viewportHandle!.collections.find(entry => entry.collection instanceof BillboardCollection)!.collection as BillboardCollection;

    expect(mapBillboard.get(0).pixelOffset).toEqual(baseBillboard.get(0).pixelOffset);
    expect(viewportBillboard.get(0).pixelOffset).not.toEqual(baseBillboard.get(0).pixelOffset);
    expect(viewportBillboard.get(0).position).toEqual(baseBillboard.get(0).position);
    expect(mapBillboard.get(0).position).not.toEqual(baseBillboard.get(0).position);
  });
});

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

function createSymbolBucketTile(name = 'Museum', layerId = 'poi-layer') {
  const builder = new SymbolBucketBuilder(createBucketOptions(layerId));
  builder.addFeature({
    id: 7,
    loadGeometry: () => [[{ x: 512, y: 512 }]],
    properties: {
      icon: ICON_DATA_URI,
      name,
    },
    type: 1,
  } as any, 0);

  const bucket = builder.build();

  return {
    buckets: [bucket],
    byteLength: bucket.stats.byteLength,
    epoch: 1,
    key: 'source/0/0/0',
  };
}

function createCrossLayerSymbolBucketTile() {
  const firstBuilder = new SymbolBucketBuilder(createBucketOptions('poi-layer-a'));
  firstBuilder.addFeature({
    id: 7,
    loadGeometry: () => [[{ x: 1536, y: 1536 }]],
    properties: {
      name: 'Museum',
    },
    type: 1,
  } as any, 0);

  const secondBuilder = new SymbolBucketBuilder(createBucketOptions('poi-layer-b'));
  secondBuilder.addFeature({
    id: 8,
    loadGeometry: () => [[{ x: 1536, y: 1536 }]],
    properties: {
      name: 'School',
    },
    type: 1,
  } as any, 0);

  const firstBucket = firstBuilder.build();
  const secondBucket = secondBuilder.build();

  return {
    buckets: [firstBucket, secondBucket],
    byteLength: firstBucket.stats.byteLength + secondBucket.stats.byteLength,
    epoch: 1,
    key: 'source/0/0/0',
  };
}

function createMixedSymbolBucketTile() {
  const builder = new SymbolBucketBuilder(createBucketOptions());
  builder.addFeature({
    id: 8,
    loadGeometry: () => [[{ x: 1024, y: 1024 }]],
    properties: {
      name: '',
    },
    type: 1,
  } as any, 0);
  builder.addFeature({
    id: 9,
    loadGeometry: () => [[{ x: 2048, y: 2048 }]],
    properties: {
      name: 'Museum',
    },
    type: 1,
  } as any, 1);

  const bucket = builder.build();

  return {
    buckets: [bucket],
    byteLength: bucket.stats.byteLength,
    epoch: 1,
    key: 'source/0/0/0',
  };
}

function createTextOnlyBucketTile(
  name = 'Library',
  position: { x: number; y: number } = { x: 1536, y: 1536 },
) {
  const builder = new SymbolBucketBuilder(createBucketOptions());
  builder.addFeature({
    id: 10,
    loadGeometry: () => [[position]],
    properties: {
      name,
    },
    type: 1,
  } as any, 0);

  const bucket = builder.build();

  return {
    buckets: [bucket],
    byteLength: bucket.stats.byteLength,
    epoch: 1,
    key: 'source/0/0/0',
  };
}

function createCurvedLineBucketTile(
  name = 'Library',
  line: Array<{ x: number; y: number }> = [
    { x: 512, y: 512 },
    { x: 2048, y: 512 },
    { x: 2048, y: 2048 },
  ],
) {
  const builder = new SymbolBucketBuilder(createBucketOptions('line-center'));
  builder.addFeature({
    id: 11,
    loadGeometry: () => [line],
    properties: {
      name,
    },
    type: 2,
  } as any, 0);

  const bucket = builder.build();

  return {
    buckets: [bucket],
    byteLength: bucket.stats.byteLength,
    epoch: 1,
    key: 'source/0/0/0',
  };
}

function createSortedSymbolBucketTile() {
  const builder = new SymbolBucketBuilder(createBucketOptions());
  builder.addFeature({
    id: 7,
    loadGeometry: () => [[{ x: 512, y: 3072 }]],
    properties: {
      name: 'South',
      priority: 20,
    },
    type: 1,
  } as any, 0);
  builder.addFeature({
    id: 8,
    loadGeometry: () => [[{ x: 512, y: 1024 }]],
    properties: {
      name: 'North',
      priority: 10,
    },
    type: 1,
  } as any, 1);

  const bucket = builder.build();

  return {
    buckets: [bucket],
    byteLength: bucket.stats.byteLength,
    epoch: 1,
    key: 'source/0/0/0',
  };
}

function createCrossLayerSymbolStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        'id': 'poi-layer-a',
        'type': 'symbol',
        'source': 'source',
        'source-layer': 'layer',
        'layout': {
          'text-field': ['get', 'name'],
        },
      },
      {
        'id': 'poi-layer-b',
        'type': 'symbol',
        'source': 'source',
        'source-layer': 'layer',
        'layout': {
          'text-field': ['get', 'name'],
        },
      },
    ],
  };
}

function createBucketOptions(
  layerId = 'poi-layer',
  symbolPlacement?: 'point' | 'line' | 'line-center',
) {
  const tilingScheme = new WebMercatorTilingScheme();
  const rect = tilingScheme.tileXYToNativeRectangle(0, 0, 0);

  return {
    extent: 4096,
    familyId: 'source/layer/symbol/0',
    layerIds: [layerId],
    sourceLayer: 'layer',
    symbolPlacement,
    tileKey: 'source/0/0/0',
    tileProjection: {
      east: rect.east,
      north: rect.north,
      south: rect.south,
      west: rect.west,
    },
  };
}

interface SymbolStyleOverrides {
  iconRotate?: number;
  iconTextFit?: 'none' | 'width' | 'height' | 'both';
  iconTextFitPadding?: [number, number, number, number];
  iconSize?: number;
  iconTranslate?: [number, number];
  iconTranslateAnchor?: 'map' | 'viewport';
  symbolAvoidEdges?: boolean;
  textHaloBlur?: number;
  textHaloColor?: string;
  textHaloWidth?: number;
  textLineHeight?: number;
  textMaxWidth?: number;
  textMaxAngle?: number;
  textSize?: number;
  textRotate?: number;
  textTranslate?: [number, number];
  textTranslateAnchor?: 'map' | 'viewport';
  textTransform?: 'none' | 'uppercase' | 'lowercase';
}

function createSymbolStyle(
  withIcon = true,
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
          ...(overrides.textRotate !== undefined
            ? {
                'text-rotate': overrides.textRotate,
              }
            : {}),
          ...(overrides.textTransform !== undefined
            ? {
                'text-transform': overrides.textTransform,
              }
            : {}),
          ...(overrides.iconTextFit !== undefined
            ? {
                'icon-text-fit': overrides.iconTextFit,
              }
            : {}),
          ...(overrides.iconTextFitPadding !== undefined
            ? {
                'icon-text-fit-padding': overrides.iconTextFitPadding,
              }
            : {}),
          'icon-anchor': 'bottom-right',
          'icon-offset': [8, -6],
          'icon-size': overrides.iconSize ?? 1.5,
          ...(overrides.symbolAvoidEdges !== undefined
            ? {
                'symbol-avoid-edges': overrides.symbolAvoidEdges,
              }
            : {}),
          'text-anchor': 'top-left',
          'text-field': ['get', 'name'],
          ...(overrides.textLineHeight !== undefined
            ? {
                'text-line-height': overrides.textLineHeight,
              }
            : {}),
          ...(overrides.textMaxAngle !== undefined
            ? {
                'text-max-angle': overrides.textMaxAngle,
              }
            : {}),
          ...(overrides.textMaxWidth !== undefined
            ? {
                'text-max-width': overrides.textMaxWidth,
              }
            : {}),
          'text-size': overrides.textSize ?? 18,
          'text-offset': [6, 4],
        },
        'paint': {
          'icon-color': '#445566',
          'icon-opacity': 0.25,
          ...(overrides.iconTranslate !== undefined
            ? {
                'icon-translate': overrides.iconTranslate,
                'icon-translate-anchor': overrides.iconTranslateAnchor ?? 'viewport',
              }
            : {}),
          'text-color': '#112233',
          ...(overrides.textHaloColor !== undefined
            || overrides.textHaloWidth !== undefined
            || overrides.textHaloBlur !== undefined
            ? {
                'text-halo-blur': overrides.textHaloBlur,
                'text-halo-color': overrides.textHaloColor,
                'text-halo-width': overrides.textHaloWidth,
              }
            : {}),
          ...(overrides.textTranslate !== undefined
            ? {
                'text-translate': overrides.textTranslate,
                'text-translate-anchor': overrides.textTranslateAnchor ?? 'viewport',
              }
            : {}),
          'text-opacity': 0.5,
        },
      },
    ],
  };
}

function createAutoSortedSymbolStyle(): StyleSpecification {
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
          'symbol-z-order': 'auto',
          'text-allow-overlap': true,
          'text-field': ['get', 'name'],
        },
      },
    ],
  };
}

function createSortedSymbolStyle(): StyleSpecification {
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
          'symbol-sort-key': ['get', 'priority'],
          'symbol-z-order': 'source',
          'text-field': ['get', 'name'],
        },
      },
    ],
  };
}

function createTextOnlySymbolStyle(
  overrides: {
    symbolAvoidEdges?: boolean;
    textLineHeight?: number;
    textMaxAngle?: number;
    textMaxWidth?: number;
    textSize?: number;
    textTranslate?: [number, number];
    textTranslateAnchor?: 'map' | 'viewport';
  } = {},
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
          'icon-image': 'missing-icon',
          ...(overrides.symbolAvoidEdges !== undefined
            ? {
                'symbol-avoid-edges': overrides.symbolAvoidEdges,
              }
            : {}),
          ...(overrides.textLineHeight !== undefined
            ? {
                'text-line-height': overrides.textLineHeight,
              }
            : {}),
          ...(overrides.textMaxAngle !== undefined
            ? {
                'text-max-angle': overrides.textMaxAngle,
              }
            : {}),
          ...(overrides.textMaxWidth !== undefined
            ? {
                'text-max-width': overrides.textMaxWidth,
              }
            : {}),
          ...(overrides.textSize !== undefined
            ? {
                'text-size': overrides.textSize,
              }
            : {}),
          'text-field': ['get', 'name'],
        },
        'paint': {
          ...(overrides.textTranslate !== undefined
            ? {
                'text-translate': overrides.textTranslate,
                'text-translate-anchor': overrides.textTranslateAnchor ?? 'viewport',
              }
            : {}),
        },
      },
    ],
  };
}
