# Cesium-MVT TODO

## 当前诊断（2026-04-13）

本文件只记录当前运行时主链路的真实问题，以及与 Cesium / MapLibre 上游源码对照后确认过的改造方向。

### 1. 运行时主链路与上游对照

| 维度                                                                | 上游源码思路                                                  | 当前实现                      | 结论                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------- | ---------------------------- |
| Cesium `QuadtreePrimitive`                                          | 多级 LOD、SSE、三档加载队列、替换队列                         | `view-state.ts` 只估单一 zoom | 只借到了“按视图选瓦片”的外壳 |
| Cesium `RequestScheduler`                                           | 请求优先级、服务端并发限制、可丢弃低优先级请求                | 运行时直接 `fetch`            | 关键调度能力未接入           |
| Cesium `TileReplacementQueue`                                       | 当前帧保活 + LRU 淘汰                                         | 只有编译后 tile 进入字节 LRU  | 生命周期模型不完整           |
| MapLibre `covering_tiles` / `tile_manager`                          | 变 zoom 覆盖、retain children / parents、query/fade 配套      | 单层覆盖 + 简化 fallback      | 语义差距明显                 |
| MapLibre `dispatcher` / `vector_tile_worker_source` / `worker_tile` | actor 池、load/reload/abort/remove 分离                       | 单 worker + 一次性编译        | 并发与生命周期偏弱           |
| MapLibre `style_layer_index` / `worker_tile`                        | groupByLayout 后仍保留每 layer filter / paint / feature-state | 只做了 layer family 分组      | family 语义未闭环            |
| MapLibre `symbol_bucket` / `placement` / `pauseable_placement`      | 文本、图标、碰撞、渐进 placement                              | 完全缺失                      | 关键地图能力缺口             |

### 2. P0：当前必须先收敛的问题

#### P0-1：样式语义没有真正进入编译链路

现状：

- `compileBucketTile()` 只按 `source-layer + geometry type` 收集 feature。
- `feature-filter.ts`、`layer-style-resolver.ts`、`style-property-evaluator.ts`、`expression-evaluator.ts` 都没有进入运行时主链路。
- `material-cache.ts` 只解析静态字面量 paint 值。

结果：

- `filter`
- 数据驱动 paint/layout
- `feature-state`
- 绝大多数 MapLibre layer 语义

都只是“有测试模块”，不是“运行时能力”。

#### P0-2：LayerFamily 只做了分组，没有保住每个 layer 的独立语义

现状：

- `fill` backend 会为 `bucket.layerIds` 中的每个 layer 建 collection。
- `line` / `circle` backend 只取 `bucket.layerIds[0]`。

结果：

- 同一个 family 内的 line/circle layer 会丢失样式、顺序和独立语义。
- 即便是 fill，当前也没有按 layer filter 拆特征，所以多个 layer 往往会画同一批 geometry。

#### P0-3：源数据缓存模型不成立

现状：

- `TileCacheManager` 只管理编译后的 `ParsedTileResult`。
- `SourceCache` / `GeojsonSourceCache` 的 ready 数据不在统一 LRU 里。
- `bucket-tile-dispatcher.ts` 会把 `tileData` 作为 transferable 发给 worker。

结果：

- 源数据缓存没有统一内存预算。
- `ArrayBuffer` 被 transfer 后会 detach，ready cache 的复用不可靠。
- `GeojsonSourceCache` 连 detached 检查都没有，风控更差。

#### P0-4：调度、优先级、取消机制都不完整

现状：

- `request-scheduler.ts` 未接入运行时。
- `tile-visibility.ts`、`tile-lifecycle.ts` 未接入运行时。
- `SourceManager.abort(key)` 没有在视图更新时使用。
- Worker cancel 只能在真正编译前生效，编译中无法中断。

结果：

- 离屏 tile 不会被及时取消。
- 没有高 / 中 / 低优先级加载队列。
- 没有按服务端并发节流。
- 没有按距离或可见性排序请求。

#### P0-5：错误状态会被永久“空瓦片化”

现状：

- `CesiumVectorTileCoordinator.requestTile()` 捕获异常后调用 `renderManager.setEmpty(key)`。
- `tile-selection.ts` 会把这类 handle 视作 `empty`。

结果：

- 网络错误、worker 错误、临时异常都会在当前 style epoch 内被当成“空瓦片”。
- 这不是 retry / backoff，而是永久跳过重试。

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

#### 当前不足

- 没有视图变化时的逐 tile abort
- 没有真正接入 Cesium `RequestScheduler`
- 没有请求优先级
- 没有按服务器并发限制
- 没有 worker 池
- 没有长任务中断
- 没有失败重试 / 指数退避

### 5. 基于 MapLibre 源码梳理的功能缺口

#### 必缺能力

- Symbol text / icon bucket
- collision index / cross-tile symbol id
- `Placement` / `PauseablePlacement`
- `queryRenderedFeatures` / `querySourceFeatures`
- `feature-state`
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
2. 让 `filter`、数据驱动 paint、`feature-state` 真正进入 bucket 编译或渲染链路。
3. 修正 family 语义，至少先解决 `line` / `circle` 只吃第一个 layer 的问题。
4. 明确 background layer 是否支持；不支持就删掉伪入口。

### 第二阶段：把请求和缓存做对

1. 把源数据缓存与编译结果缓存拆成清晰的两层，并统一内存预算。
2. 修复 transferable 导致的缓存 detach 问题。
3. 让 TileJSON 约束在参与调度前可用。
4. 建立失败重试与退避，不再用 empty handle 吞掉错误。

### 第三阶段：把调度做成真正的 Cesium 风格

1. 参考 `QuadtreePrimitive` 引入可排序的加载队列。
2. 接入 `RequestScheduler` 或等价能力。
3. 增加视图变化时的 out-of-view abort。
4. 从单层 zoom 走向多层 LOD / SSE。

### 第四阶段：补齐 MapLibre 的核心地图能力

1. Symbol / text / icon / collision
2. Feature query
3. line dash / pattern / fill pattern
4. fill extrusion

## 本轮建议优先级

### 先做

- [ ] 修正 layer 语义：filter + family + line/circle 多 layer 问题
- [ ] 修正源数据缓存：统一预算 + detached buffer 问题
- [ ] 接入真实请求调度：优先级、取消、离屏 abort
- [ ] 去掉“失败即 empty”模型，改成可重试失败态

### 后做

- [ ] 多 LOD / SSE
- [ ] Worker 池
- [ ] Symbol 与 query
- [ ] pattern / extrusion
