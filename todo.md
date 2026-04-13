# Cesium-MVT TODO

## 当前诊断（2026-04-13）

本文件只记录当前运行时主链路的真实问题，以及与 Cesium / MapLibre 上游源码对照后确认过的改造方向。

### 1. 运行时主链路与上游对照

| 维度                                                                | 上游源码思路                                                  | 当前实现                                                                                                   | 结论                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Cesium `QuadtreePrimitive`                                          | 多级 LOD、SSE、三档加载队列、替换队列                         | `view-state.ts` 只估单一 zoom                                                                              | 只借到了“按视图选瓦片”的外壳           |
| Cesium `RequestScheduler`                                           | 请求优先级、服务端并发限制、可丢弃低优先级请求                | 默认 loader 已接入，`update()` 也会每帧执行                                                                | 主请求链路已接通，仍可继续细化队列策略 |
| Cesium `TileReplacementQueue`                                       | 当前帧保活 + LRU 淘汰                                         | 只有编译后 tile 进入字节 LRU                                                                               | 生命周期模型不完整                     |
| MapLibre `covering_tiles` / `tile_manager`                          | 变 zoom 覆盖、retain children / parents、query/fade 配套      | 单层覆盖 + 简化 fallback                                                                                   | 语义差距明显                           |
| MapLibre `dispatcher` / `vector_tile_worker_source` / `worker_tile` | actor 池、load/reload/abort/remove 分离                       | 单 worker + 一次性编译                                                                                     | 并发与生命周期偏弱                     |
| MapLibre `style_layer_index` / `worker_tile`                        | groupByLayout 后仍保留每 layer filter / paint / feature-state | 只做了 layer family 分组，但 fill / line / circle 后端已经按 layer filter / paint / feature-state 独立求值 | family 语义未闭环                      |
| MapLibre `symbol_bucket` / `placement` / `pauseable_placement`      | 文本、图标、碰撞、渐进 placement                              | 完全缺失                                                                                                   | 关键地图能力缺口                       |

### 2. P0：当前必须先收敛的问题

#### P0-1：样式语义没有真正进入编译链路（已修复）

现状：

- `compileBucketTile()` 现在会接收 `style`，并按 `style.layers` 把同一 geometry batch 拆成独立的 layer bucket。
- 静态 `filter` 已前置到编译阶段；包含 `feature-state` 的动态表达式仍保留到渲染期评估，避免把动态语义提前固化。

结果：

- bucket 编译层已经把可静态判断的样式语义前置。
- 动态语义仍由 render backend 处理，编译和渲染的边界已经收敛。

#### P0-2：LayerFamily 只做了分组，没有保住每个 layer 的独立语义（已修复）

现状：

- `fill` / `line` / `circle` backend 仍然会按 `bucket.layerIds` 为每个 layer 独立建 collection。
- bucket 编译阶段现在也会按 layer 拆桶，并把静态 `filter` 前置到 feature 切分里。

结果：

- 同一个 family 内的 layer 在编译层和渲染层都能保留独立语义。
- family 只负责几何和布局兼容分组，不再承担额外的语义折叠。

#### P0-3：源数据缓存已收口到统一预算（已修复）

现状：

- `TileCacheManager` 现在和 `SourceCache` / `GeojsonSourceCache` 共享同一条 ready 字节预算。
- `SourceCache` / `GeojsonSourceCache` 已经会给调用方返回独立副本，worker transfer 不会再直接 detach 缓存本体。
- `SourceCache` / `GeojsonSourceCache` 仍各自维护请求状态，但 ready entry 已接入共享预算。
- `bucket-tile-dispatcher.ts` 仍然会把调用方那份 `tileData` 作为 transferable 发给 worker。

结果：

- 源数据缓存和编译结果缓存已经收口到同一条预算里。
- 统一预算下的回收顺序、预算大小和冷热 tile 占比仍然需要继续观察和调优。

#### P0-4：调度、优先级、取消机制已接通主链路，队列策略和编译中断已补齐（已修复）

现状：

- `request-scheduler.ts` 已接入运行时默认 loader，TileJSON / GeoJSON / tile 请求都会走 `RequestScheduler`。
- `CesiumVectorTileCoordinator.update()` 会在每帧末尾驱动 `RequestScheduler.update()`。
- `SourceManager.requestTile()`、`SourceCache`、`GeojsonSourceCache` 都已经透传 priority / signal，pending 请求也会复用同一个可变 priorityState。
- `TileScheduler.resolveSourceTiles()` 现在会把请求队列按视图中心优先排序；`CesiumVectorTileCoordinator.processTileSelection()` 仍然会在每帧重新回放 pending 请求，刷新同一个可变 priorityState。
- `computeTileLifecycle()` 已经进入请求路径，用来让缓存命中的瓦片直接回到展示分支。
- `bucket-tile-dispatcher.ts` 已接入 worker 池，空闲时可并行编译多个瓦片；编译中的任务被中止时会直接终止对应 worker 并重新补位。

结果：

- 目前还是 `RequestScheduler` 排队 + 可变 priorityState 刷新，但请求顺序已经从纯扫描顺序收紧为中心优先。
- 仍然没有 MapLibre 那种更细的多级加载队列。
- 动态 priority 重算还可以继续细化，但主请求顺序已经从纯扫描收紧为中心优先。

#### P0-5：错误重试已接入统一退避和到期唤醒（已修复）

现状：

- `SourceCache` / `GeojsonSourceCache` 已经记录 `failureCount` 和 `nextRetryAt`，冷却期会直接返回 `RequestThrottledError`。
- `CesiumVectorTileCoordinator.update()` 会在当前请求集合的重试时间到点后主动唤醒 selection 重新尝试。

结果：

- 临时网络错误不会每帧盲目重试；到点后会重新进入请求链路。

### 3. P1：高价值但次一级的问题

#### P1-1：单层 zoom 调度过于粗糙

现状：

- `view-state.ts` 只用 `camera.computeViewRectangle()` 与 `viewportWidth` 估单一 zoom。
- `viewportHeight` 没有参与调度。
- 当前实现没有真正复用 `tile-visibility.ts` 的视锥与地平线判断。

影响：

- 和 Cesium `QuadtreePrimitive`、MapLibre `covering_tiles` 的多层混合思路差距很大。
- 容易在远处过采样、近处欠采样。

#### P1-2：TileJSON 约束获取过晚

现状：

- `SourceCache` 在首次请求 tile 时才懒加载 TileJSON。
- `TileScheduler.resolveSourceTiles()` 在 TileJSON 未就绪前拿不到 `minzoom` / `maxzoom`。

影响：

- 首批请求可能先按错误 zoom 发出去。
- 与 MapLibre 先 `loadTileJson()` 再参与 tile manager 调度的模型不一致。

#### P1-3：热路径内有明显的额外分配

现状：

- bucket builder 仍大量使用 `number[] -> TypedArray`。
- `line` backend 渲染时会对每条 polyline 做 `slice()`。
- `circle` backend 为每个点创建新的 `Cartesian3`。
- `RenderManager.hideInvisibleTiles()` 每轮都全量扫描已挂载 key。

影响：

- GC 压力偏大。
- render path 和 compile path 都存在不必要分配。

#### P1-4：FeatureIndex 已写入，但查询能力缺失

现状：

- bucket builder 会复制 `feature.properties` 并生成 `featureIndex`。
- 当前对外没有 `queryRenderedFeatures` / `querySourceFeatures` 对应能力。

影响：

- 内存已经付出，但功能没有闭环。
- 这是典型“先存一份以后可能有用”的负优化。

#### P1-5：测试覆盖与真实运行时脱节

现状：

- 多个模块有完整单测，但这些模块不在主链路。
- 当前主链路最容易出问题的地方，反而缺少 source -> bucket -> render 的语义级回归测试。

影响：

- “测试通过”不等于“运行时能力已接入”。
- 容易继续累积看似完整、实际未落地的实现。

### 4. 取消机制与优先级调度结论

#### 当前已有

- source 请求支持 `AbortController`
- style update / destroy 会 `abortAll()`
- worker dispatcher 支持 cancel message
- pending request 会在同一 key 内去重
- 默认 tile / TileJSON / GeoJSON 请求已经接入 `RequestScheduler`
- coordinator 会在每帧末尾执行 `RequestScheduler.update()`

#### 当前不足

- 没有真正的动态 priority 重算
- 没有按 Cesium 那种多级队列去分发请求
- 没有 worker 池
- 没有长任务中断
- 没有失败重试 / 指数退避

### 5. 基于 MapLibre 源码梳理的功能缺口

#### 必缺能力

- Symbol text / icon bucket
- collision index / cross-tile symbol id
- `Placement` / `PauseablePlacement`
- `queryRenderedFeatures` / `querySourceFeatures`
- line dash / line pattern / fill pattern
- fill extrusion
- background layer 实际渲染

#### 当前只做了“前半步”的能力

- Layer family 分组：有
- family 对应的 layer 语义保留：没有
- FeatureIndex 数据结构：有
- 查询链路：没有
- worker cancel 壳子：有
- 真正的调度与 worker 池：没有

### 6. 代码质量与结构问题

#### 命名与职责

- `request-scheduler.ts` 与 `tile-request.ts` 都有 `createTileRequest()`，命名冲突且语义不同。
- `TileCacheManager` 名字像“统一 tile cache”，实际只缓存编译结果。
- `feature-tile.ts` / `feature-tile-dispatcher.ts` 是完整旁路实现，目前没有进入运行时。

#### 结构

- 存在多条并行但未闭环的“候选实现”。
- 文档与测试会被这些候选实现误导，认为能力已经上线。

#### 建议

- 先明确唯一主链路，再决定“接入”还是“删除”这些旁路模块。
- 对任何不在运行时中的模块，文档必须明确标注“未接入”，不要再写成“已支持”。

## 改造路线

### 第一阶段：把语义做正确

1. 统一样式模型，决定只走一种运行时方案。
2. 让 `filter`、数据驱动 paint 进一步前置到 bucket 编译链路。
3. 修正 family 语义，至少先解决 `line` / `circle` 只吃第一个 layer 的问题。
4. 明确 background layer 是否支持；不支持就删掉伪入口。

### 第二阶段：把请求和缓存做对

1. 已把源数据缓存与编译结果缓存收口到统一预算，后续只需继续观察参数和边界。
2. 修复 transferable 导致的缓存 detach 问题。
3. 让 TileJSON 约束在参与调度前可用。
4. 建立失败重试与退避，不再用 empty handle 吞掉错误。

### 第三阶段：把调度做成真正的 Cesium 风格

1. 参考 `QuadtreePrimitive` 引入可排序的加载队列。
2. 接入 `RequestScheduler` 或等价能力，继续补动态 priority 重算。
3. 增加视图变化时的 out-of-view abort，并进一步统一 tile visibility / lifecycle。
4. 从单层 zoom 走向多层 LOD / SSE。

### 第四阶段：补齐 MapLibre 的核心地图能力

1. Symbol / text / icon / collision
2. Feature query
3. line dash / pattern / fill pattern
4. fill extrusion

## 本轮建议优先级

### 先做

- [x] 修正 layer 语义：filter + family + line/circle 多 layer 问题
- [x] 修正源数据缓存：统一预算 + detached buffer 问题
- [x] 接入真实请求调度：优先级、取消、离屏 abort
- [x] 继续补请求优先级的动态重算
- [x] 补 worker 池与编译中断
- [x] 去掉“失败即 empty”模型，改成可重试失败态

### 后做

- [ ] 多 LOD / SSE
- [ ] Symbol 与 query
- [ ] pattern / extrusion
