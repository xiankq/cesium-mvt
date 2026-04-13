# Cesium-MVT TODO

## 当前诊断（2026-04-13）

本文件只记录当前运行时主链路的真实问题，以及与 Cesium / MapLibre 上游源码对照后确认过的改造方向。

### 1. 运行时主链路与上游对照

| 维度                                                                | 上游源码思路                                             | 当前实现                                             | 结论                         |
| ------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| Cesium `QuadtreePrimitive`                                          | 多级 LOD、SSE、三档加载队列、替换队列                    | `view-state.ts` 只估单一 zoom                        | 只借到了“按视图选瓦片”的外壳 |
| Cesium `RequestScheduler`                                           | 请求优先级、服务端并发限制、可丢弃低优先级请求           | 请求链路已接通，但队列策略仍偏粗                     | 仍可继续细化队列策略         |
| Cesium `TileReplacementQueue`                                       | 当前帧保活 + LRU 淘汰                                    | 只有编译后 tile 进入字节 LRU                         | 生命周期模型不完整           |
| MapLibre `covering_tiles` / `tile_manager`                          | 变 zoom 覆盖、retain children / parents、query/fade 配套 | 单层覆盖 + 简化 fallback                             | 语义差距明显                 |
| MapLibre `dispatcher` / `vector_tile_worker_source` / `worker_tile` | actor 池、load/reload/abort/remove 分离                  | worker 池已接入，但并发与生命周期仍弱于上游 actor 池 | 并发与生命周期偏弱           |
| MapLibre `symbol_bucket` / `placement` / `pauseable_placement`      | 文本、图标、碰撞、渐进 placement                         | 完全缺失                                             | 关键地图能力缺口             |

### 2. P1：高价值但次一级的问题

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

### 3. 取消机制与优先级调度结论

#### 当前不足

- 没有真正的动态 priority 重算
- 没有按 Cesium 那种多级队列去分发请求

### 4. 基于 MapLibre 源码梳理的功能缺口

#### 必缺能力

- Symbol text / icon bucket
- collision index / cross-tile symbol id
- `Placement` / `PauseablePlacement`
- `queryRenderedFeatures` / `querySourceFeatures`
- line dash / line pattern / fill pattern
- fill extrusion

### 5. 代码质量与结构问题

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

### 第二阶段：把请求和缓存做对

1. 让 TileJSON 约束在参与调度前可用。

### 第三阶段：把调度做成真正的 Cesium 风格

1. 参考 `QuadtreePrimitive` 引入可排序的加载队列。
2. 在现有 `RequestScheduler` 基础上继续补动态 priority 重算。
3. 增加视图变化时的 out-of-view abort，并进一步统一 tile visibility / lifecycle。
4. 从单层 zoom 走向多层 LOD / SSE。

### 第四阶段：补齐 MapLibre 的核心地图能力

1. Symbol / text / icon / collision
2. Feature query
3. line dash / pattern / fill pattern
4. fill extrusion

## 本轮建议优先级

### 后做

- [ ] 多 LOD / SSE
- [ ] Symbol 与 query
- [ ] pattern / extrusion
