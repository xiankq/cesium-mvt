# Cesium MVT

基于 Cesium 的 MVT（Mapbox Vector Tile）实验性渲染实现。

## 当前状态

这套实现已经打通了“样式加载 -> 瓦片选择 -> 源数据请求 -> Bucket 编译 -> Cesium `Buffer*Collection` 渲染”的主链路，但它目前更接近“可运行的基础版本”，还不能视为和 MapLibre 或 Cesium 原生瓦片体系等价。

当前真正进入运行时主链路的能力只有：

- Vector source / GeoJSON source
- `fill` / `line` / `circle` 三类基础几何
- `fill` / `line` / `circle` 后端已接入 `filter`、表达式和 `feature-state`，写入后会刷新已挂载瓦片
- 祖先瓦片 fallback
- 编译后瓦片的字节级 LRU
- Worker / Inline 两种 bucket 编译模式
- 请求层已接入 Cesium `RequestScheduler`，默认加载器会透传 priority / serverKey / abort
- 样式 epoch 驱动的整层重建

当前没有真正接入主链路的能力包括：

- 视锥 / 地平线可见性裁剪
- Symbol 文本与碰撞检测
- Feature Query
- Background layer 渲染

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm build
```

### 运行测试

```bash
pnpm test
```

### 代码检查

```bash
pnpm lint:eslint --fix
pnpm lint:tsc
```

## 使用示例

```typescript
import { CesiumVectorTile } from './mvt/cesium-vector-tile';

const mvtLayer = await CesiumVectorTile.fromUrl(
  'https://tiles.openfreemap.org/styles/liberty',
);

viewer.scene.primitives.add(mvtLayer);
```

## 主链路

```text
Cesium 帧循环
  -> CesiumVectorTileCoordinator.update()
  -> TileScheduler.schedule()
  -> resolveTileSelection()
  -> SourceManager.requestTile()
     -> SourceCache / GeojsonSourceCache
     -> BucketTileDispatcher.compile()
        -> compileBucketTile()
        -> Fill / Line / CircleBucketBuilder
  -> RenderManager.mount()
     -> BufferPolygonCollection / BufferPolylineCollection / BufferPointCollection
```

这条链路里的关键现实约束是：

- 调度层目前基于 `camera.computeViewRectangle()` 和 `viewportWidth` 估算单一 zoom，不是 Cesium `QuadtreePrimitive` 那种多级 LOD + SSE。
- 请求层已经通过 Cesium `RequestScheduler` + `Resource` 接入默认 tile / TileJSON / GeoJSON 请求，`CesiumVectorTileCoordinator.update()` 也会每帧驱动 `RequestScheduler.update()`。
- 样式层已经把 `filter`、表达式和 `feature-state` 接进 `fill` / `line` / `circle` 后端，但 `background`、`symbol` 与查询链路仍未接入。
- 渲染层目前直接挂 `PrimitiveCollection`，没有复用 Cesium 现成的地表瓦片基础设施。

## 与上游源码对照

本轮分析对照的上游实现主要包括：

- Cesium：`RequestScheduler`、`QuadtreePrimitive`、`TileReplacementQueue`
- MapLibre GL JS：`covering_tiles`、`tile_manager`、`vector_tile_source`、`vector_tile_worker_source`、`worker_tile`、`style_layer_index`、`feature_index`、`symbol_bucket`、`placement`、`pauseable_placement`

### 结论概览

| 维度        | 上游思路                                                                            | 当前状态                                                 | 结论                                   |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| 视图覆盖    | Cesium / MapLibre 都会按 tile 粒度做更细的覆盖与优先级计算                          | 单一 zoom + 矩形覆盖                                     | 明显简化                               |
| 请求调度    | Cesium 有 `RequestScheduler`，MapLibre 有 `TileManager` + actor/worker 体系         | 默认 loader 已接入 `RequestScheduler`，仍是静态 priority | 主请求链路已接通，细粒度队列还可继续补 |
| Worker 模型 | MapLibre 默认多 worker actor 池                                                     | 单 worker / inline                                       | 吞吐明显偏弱                           |
| LayerFamily | 借鉴了 MapLibre `groupByLayout` 思路                                                | 只完成了 family 分组，没有把 layer 语义完整保留下来      | 只借到“形”，没借到“义”                 |
| 缓存        | Cesium 有统一 tile 生命周期与替换队列；MapLibre 有 in-view / out-of-view tile cache | 编译后 tile 与源数据 ready tile 已接到同一条共享字节预算 | 部分借鉴                               |
| Symbol      | MapLibre 有 `symbol_bucket + placement + pauseable_placement` 全链路                | 完全缺失                                                 | 关键能力缺口                           |

## 运行时已实现

### 数据源

- Vector source：支持内联 `tiles` 与远程 TileJSON
- GeoJSON source：先转成内存内 MVT，再复用同一编译链路
- TMS / XYZ 模板替换

### 几何编译

- Fill：`earcut` 三角剖分 + 网格细分
- Line：测地线细分
- Circle：点精灵

### 渲染与缓存

- 编译结果以 `ParsedTileResult` 进入 `TileCacheManager`
- 祖先 fallback 可避免完全白洞
- 样式更新通过 `styleEpoch` 让旧渲染结果整体失效

## 当前已知问题

### 语义正确性

- `filter`、表达式、`feature-state` 已进入 `fill` / `line` / `circle` 后端，但 `background`、`symbol` 与查询链路仍未接入。
- `line` / `circle` 已经按 `bucket.layerIds` 展开为独立 collection，和 `fill` 的按 layerId 展开思路一致，但 family 仍然没有按 `filter` / 数据驱动样式切分 feature。
- `background` layer 会进入 `RenderTile`，但没有实际渲染后端。
- 当前 bucket 编译阶段按 `source-layer + geometry type` 抓取全部 feature，没有按 layer filter 切分。

### 调度与取消

- 视图变化时会主动中止过期的 pending 请求，请求层也已经接入 Cesium `RequestScheduler` 和按请求顺序的 priority 透传。
- `RequestScheduler.update()` 会在每帧 `CesiumVectorTileCoordinator.update()` 末尾执行，保证排队请求能够继续推进。
- 目前的 priority 仍是按请求顺序分配的静态值，后续还可以继续补基于相机距离的动态重排。
- Worker 取消只能在编译真正开始前生效，长时间编译中的任务无法中断。
- TileJSON 的 `minzoom` / `maxzoom` 约束是懒加载得到的，首批请求可能先按错误 zoom 发出去。

### 性能与内存

- 编译后 tile 与源数据 ready tile 现在共用同一条共享字节预算，源数据缓存不再是独立预算。
- `ArrayBuffer` 的 worker transfer 已经不会再直接 detach 缓存本体，整体内存压力现在由统一预算兜底，但预算参数和冷热 tile 占比仍值得继续观察。
- `number[] -> TypedArray` 的构建方式和渲染期切片/对象创建会引入额外分配。
- `RenderManager.getAllKeys()` 每次更新都全量扫描已挂载瓦片。
- `FeatureIndex` 和属性浅拷贝已经存进 bucket，但运行时没有查询链路消费它们。

### 代码结构

- 多个模块只被测试引用，不在运行时主链路：`request-scheduler.ts`、`tile-visibility.ts`、`tile-lifecycle.ts`、`feature-tile-dispatcher.ts`。
- 这会让单测通过与运行时真实能力之间出现偏差，文档也容易被“测试存在”误导成“功能已接入”。

## 文档说明

- [todo.md](./todo.md) 是当前实现问题与改造路线的权威入口。
- [`.archive/mvt-analysis-report.md`](./.archive/mvt-analysis-report.md) 保留历史分析快照，不再保证与当前实现完全一致。

详细路线图见 [todo.md](./todo.md)。

## 开发指南

详细开发规范请参考 [AGENTS.md](./AGENTS.md)。

当前推荐的工程策略是：

- 优先让文档、测试、运行时主链路三者保持一致
- 优先复用 Cesium、MapLibre 及其子模块已有能力
- 对未接入主链路的模块，显式标记为“候选实现”或直接删除

## 许可证

私有项目
