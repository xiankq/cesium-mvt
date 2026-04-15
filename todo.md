# Cesium-MVT 路线图

> 基于 Cesium 与 MapLibre 当前主线源码语义整理。目标不是照搬上游名字，而是把本仓库里已经存在的 helper / cache / pool 接到正确主链路上，并补齐仍然缺失的语义。
>
> 重要原则：如果现有实现的模型不对，允许直接重构、替换甚至删除，不要求在旧实现上叠加补丁。

---

## 一、状态校准

### 1. 已有实现，但允许重构 / 替换

下面这些能力在仓库里已经有代码或基础测试了，后续不应再按“从零实现”写；但如果语义、结构或职责边界不对，完全可以直接重构、替换或删除冗余实现：

- `src/mvt/utils/worker-count.ts` + `src/mvt/utils/worker-pool-dispatcher.ts`
  - 动态 worker 池已经存在，后续可以直接重做调度接入层，不必拘泥于当前封装。
- `src/mvt/style/style-expression-cache.ts` + `src/mvt/style/filter-cache.ts`
  - 表达式与 filter 缓存已经有了，后续重点是失效边界和主链路接入；如果当前缓存模型不对，也可以直接替换。
- `src/mvt/render/material-pool.ts` + `src/mvt/render/render-object-pool.ts`
  - 池化基础已经有了，但如果现有池化结构不满足渲染生命周期，允许直接重构成新的资源管理模型。
- `src/mvt/utils/optimized-lru-cache.ts` + `src/mvt/utils/tile-budget.ts` + `src/mvt/utils/visibility-aware-cache.ts`
  - 缓存和预算语义已经有骨架，真正欠缺的是替换队列和生命周期整合；如果这组抽象不合适，可以合并或重做。
- `src/mvt/source/tile-sse.ts` + `src/mvt/source/tile-frustum-culling.ts` + `src/mvt/source/tile-horizon-culling.ts` + `src/mvt/source/tile-fog-culling.ts`
  - culling helper 已经存在，问题是有没有接进调度主链路；如果当前组织方式不合适，优先重构主调度入口。
- `src/mvt/source/dynamic-tile-priority.ts`
  - 动态优先级 helper 已经存在，问题是是否真正参与请求排序；必要时可直接改成调度层的一部分。
- `src/mvt/style/sprite-atlas.ts`
  - sprite atlas 缓存已存在，后续重点是接入与失效；如果缓存结构限制了语义，允许直接改结构。
- `src/mvt/render/backend/symbol-placement-grid.ts` + `src/mvt/render/backend/symbol-placement-index.ts`
  - 符号碰撞索引已有基础实现，但语义还没完全对齐 MapLibre；这块很可能需要合并、替换或重写。
- `src/mvt/render/tile-spatial-index.ts` + `src/mvt/render/render-query.ts`
  - 查询空间索引已经有了，后续重点是语义一致性和回归测试；如果查询模型需要收敛，可以整体重做。

### 2. 仍然欠缺的主链路

从 Cesium / MapLibre 的源码语义对照来看，当前真正还缺的是下面几类：

- 瓦片覆盖与调度主链路仍然偏简化，核心还是单一 zoom + 矩形覆盖；这里允许直接重构调度入口，不要求保留旧路径。
- 请求优先级仍偏静态，虽然有 helper，但没有形成完整重排策略；可以把 helper 直接并入调度层。
- 缓存已经有预算和 LRU 骨架，但还没有稳定的“可见 / 不可见 / 回退 / 过期”生命周期；必要时可把现有 cache 抽象重做。
- worker 编译链路已经能跑，但增量重编译、取消边界和最小重算还没收敛；编译链路本身也可以重构。
- Symbol 的 collision / placement / query 语义仍然是当前最大的精度缺口；这条线优先级最高，允许对现有实现做大手术。
- 性能监控和基准数据不足，很多收益数字不应该继续写死。

---

## 二、优先级路线图

### P0 1. 瓦片覆盖与调度主链路

**目标**

- 把 `collectSceneViewTileSelection()` 从“单一 zoom + 矩形覆盖”升级为真正的覆盖驱动入口。
- 把已经存在的 SSE / frustum / horizon / fog helper 接到主调度路径里。
- 把 MapLibre 式的视口覆盖和 Cesium 式的 SSE / foveated / preload 语义统一起来。

**需要完成**

- [ ] 将 `src/mvt/source/tile-scheduler.ts` 从“只比较 selection key”升级为真正的调度决策层。
- [ ] 把 `src/mvt/source/tile-sse.ts` 接到 tile 选择和请求优先级里，而不是只作为孤立工具函数。
- [ ] 把 `src/mvt/source/tile-frustum-culling.ts`、`src/mvt/source/tile-horizon-culling.ts`、`src/mvt/source/tile-fog-culling.ts` 接入可见性判断。
- [ ] 补齐 Cesium 风格的调度参数语义：`maximumScreenSpaceError`、`dynamicScreenSpaceError`、`foveatedScreenSpaceError`、`preferLeaves`、`preloadFlightDestinations`、`loadSiblings`、`progressiveResolutionHeightFraction`。
- [ ] 保留 MapLibre 风格的 covering tiles 思路，但不要把覆盖退化成纯矩形扫描。
- [ ] 把“祖先 fallback + 后代覆盖”作为调度结果的一等公民，而不是事后补丁。

**参考上游**

- Cesium: `packages/engine/Source/Scene/Cesium3DTileset.js`
- Cesium: `packages/engine/Source/Scene/QuadtreePrimitive.js`
- Cesium: `packages/engine/Source/Scene/TileReplacementQueue.js`
- MapLibre: `src/geo/projection/covering_tiles.ts`
- MapLibre: `src/tile/tile_manager.ts`

---

### P0 2. 请求优先级、取消与重排

**目标**

- 让请求队列真正根据场景变化重排，而不是按提交顺序推进。
- 把动态优先级从 helper 变成实际使用的策略。

**需要完成**

- [ ] 让 `src/mvt/source/dynamic-tile-priority.ts` 成为请求优先级的真实输入。
- [ ] 把请求优先级从“请求顺序”改为“距离 + SSE + 视口中心 + 失败重试时间”的综合分值。
- [ ] 视图变化时对未发出的请求进行重排；对已发出的请求只在安全边界内取消。
- [ ] 明确 TileJSON 懒加载、失败退避和重试窗口的优先级策略，避免首批请求反复打错 zoom。
- [ ] 统一 `source-cache`、`geojson-source-cache` 和 `request-scheduler` 的取消语义。

**参考上游**

- Cesium: `packages/engine/Source/Core/RequestScheduler.js`
- MapLibre: `src/source/vector_tile_source.ts`
- MapLibre: `src/tile/tile_manager.ts`

---

### P0 3. 缓存与生命周期

**目标**

- 把“可见 / 不可见 / 回退 / 过期 / pending”变成统一的生命周期模型。
- 不要只做 LRU，要把替换队列和销毁时机一起管起来。

**需要完成**

- [ ] 将 `TileBudget`、`TileCacheManager`、`VisibilityAwareCache` 的职责边界收敛清楚。
- [ ] 让淘汰优先发生在不可见瓦片上，而不是机械地按插入顺序删。
- [ ] 为 cached tile、pending tile 和 fallback tile 分别定义可保留时长与销毁时机。
- [ ] 对齐 Cesium 的 `cacheBytes + maximumCacheOverflowBytes` 语义，而不是只保留一个静态预算。
- [ ] 对齐 Cesium `TileReplacementQueue` 的“本帧未选中瓦片仍可暂留”的行为。
- [ ] 渲染对象和 GPU 资源的销毁路径必须跟缓存淘汰同步，避免只删 key 不释放底层 primitive。

**参考上游**

- Cesium: `packages/engine/Source/Scene/Cesium3DTilesetCache.js`
- Cesium: `packages/engine/Source/Scene/TileReplacementQueue.js`
- MapLibre: `src/tile/tile_manager.ts`

---

### P0 4. Worker 编译与增量重编译

**目标**

- 保留动态 worker 池，但把它和真实负载、取消和增量编译绑定起来。
- 不要把请求、解码、编译、挂载揉成一锅。

**需要完成**

- [ ] 保留 `WorkerPoolDispatcher` 的动态 worker 池，但把队列深度、取消时机和负载反馈接进去。
- [ ] 让 bucket 编译在样式变化、source 变化和 feature-state 变化时尽量只做最小重算。
- [ ] 给长时间编译任务增加可中断边界，避免过期结果长期占用 CPU。
- [ ] 明确 worker / inline / compile 三段职责，避免分支里同时做请求、解码和渲染准备。
- [ ] 如果后续要做真正的增量编译，先把 diff 边界定清楚，再动实现。

**参考上游**

- MapLibre: `src/source/worker_tile.ts`
- MapLibre: `src/source/vector_tile_source.ts`
- 本仓库: `src/mvt/bucket/bucket-tile-dispatcher.ts`
- 本仓库: `src/mvt/source/source-manager.ts`

---

### P1 5. Layer 预处理与样式失效

**目标**

- 把 `LayerFamily` 从“按 layout 归组”升级为“按会影响编译结果的语义分组”。
- 让样式失效边界更精确，避免全量重编译。

**需要完成**

- [ ] 让 `LayerFamily` 不只看 layout，还要考虑 `filter`、数据驱动 paint、图像依赖等会影响结果的因素。
- [ ] 保留 `styleEpoch` 作为整层重建边界，但不要让每一次变化都回退成全量重编译。
- [ ] 把 `filter-cache`、`style-expression-cache` 和 layer family 的失效逻辑接到同一套规则上。
- [ ] 给 style 更新、source 更新和 feature-state 更新分别定义触发范围。

**参考上游**

- MapLibre: `src/style/style_layer_index.ts`
- MapLibre: `src/source/worker_tile.ts`
- 本仓库: `src/mvt/style/layer-family.ts`
- 本仓库: `src/mvt/style/style-manager.ts`
- 本仓库: `src/mvt/style/filter-cache.ts`
- 本仓库: `src/mvt/style/style-expression-cache.ts`

---

### P1 6. Symbol placement 与 collision 语义补齐

**目标**

- 这是当前最需要继续收敛的方向。
- 目标不是单纯“能显示”，而是尽量贴近 MapLibre 的 symbol bucket + collision + placement + pauseable placement 语义。

**需要完成**

- [ ] 以 MapLibre `collision_index` / `placement` / `pauseable_placement` 为对照，补齐跨瓦片、跨 source 的碰撞语义。
- [ ] 把现有 `symbol-placement-grid` 和 `symbol-placement-index` 收敛成单一权威实现，避免近似判断长期并存。
- [ ] 补齐 variable anchor、line placement、`text-ignore-placement`、`icon-ignore-placement`、`symbol-avoid-edges` 的一致性。
- [ ] 让 `queryRenderedFeatures()` 中的 symbol 结果和实际可见 placement 对齐，不能只看 source feature 是否存在。
- [ ] 如果 placement 成本继续上升，再考虑做 pauseable / time-sliced placement，而不是先盲目堆索引。

**参考上游**

- MapLibre: `src/symbol/collision_index.ts`
- MapLibre: `src/symbol/placement.ts`
- MapLibre: `src/style/pauseable_placement.ts`
- MapLibre: `src/data/feature_index.ts`
- 本仓库: `src/mvt/render/render-manager.ts`
- 本仓库: `src/mvt/render/backend/symbol-placement-index.ts`
- 本仓库: `src/mvt/render/render-query.ts`

---

### P1 7. 查询链路与空间索引

**目标**

- 让 `querySourceFeatures()` 和 `queryRenderedFeatures()` 共享尽量一致的空间索引和过滤语义。
- 不要把查询优化写成空泛的“Feature Index 缓存”。

**需要完成**

- [ ] 统一 `querySourceFeatures()` 与 `queryRenderedFeatures()` 的空间索引入口。
- [ ] 让 `FeatureIndex`、`tile-spatial-index`、`render-query-utils` 共享同一套过滤语义。
- [ ] 为 `feature-state + filter + geometry query` 组合补回归测试。
- [ ] 明确 symbol 查询必须依赖可见 placement，普通几何查询则只依赖空间索引和 filter。

**参考上游**

- MapLibre: `src/data/feature_index.ts`
- 本仓库: `src/mvt/render/tile-spatial-index.ts`
- 本仓库: `src/mvt/render/render-query.ts`
- 本仓库: `src/mvt/source/source-query.ts`

---

### P2 8. 性能观测与回归基线

**目标**

- 先有数据，再写收益。
- 现在这些百分比大多没有基准支撑，后续不应该继续当成事实写在 TODO 里。

**需要完成**

- [ ] 增加请求、编译、挂载、隐藏、移除、缓存命中、worker 队列深度、symbol placement 耗时的统计。
- [ ] 把“预期收益百分比”替换成可复现的基准测试结果。
- [ ] 建立回归场景：快速平移、长时间飞行、样式频繁切换、symbol 密集区、缓存抖动。
- [ ] 给每个 P0 / P1 条目补一个最小回归测试入口，防止优化把已有语义打坏。

---

## 三、旧条目校准

这部分是把旧 TODO 编号映射到新结论，方便和历史记录对照。

| 旧条目                      | 结论                                               |
| --------------------------- | -------------------------------------------------- |
| TODO 1                      | 保留，但重写为“覆盖 + SSE + culling + preload”     |
| TODO 2                      | 不再从零实现，改为“动态优先级重排”                 |
| TODO 3                      | 改为“缓存与生命周期语义”                           |
| TODO 4                      | 改为“样式失效与增量预编译”                         |
| TODO 5                      | 改为“材质池接入与销毁路径”                         |
| TODO 6                      | 改为“Filter 预编译与缓存接入”                      |
| TODO 7 / TODO 11            | 合并为“Symbol placement / collision”               |
| TODO 8                      | 已有池化实现，改为接入或删除冗余实现               |
| TODO 9                      | 改为“TileCache / TileBudget 的淘汰语义”            |
| TODO 10 / TODO 12 / TODO 13 | 合并到“瓦片覆盖与调度主链路”                       |
| TODO 14                     | 保留，作为“增量重编译”                             |
| TODO 15                     | 改为“GPU 资源生命周期”                             |
| TODO 16                     | 降级为次要项，优先确认 sprite atlas 是否已满足需求 |
| TODO 17                     | 保留，但必须绑定查询链路和回归测试                 |
| TODO 18 / TODO 19 / TODO 20 | 不宜单列，除非基准测试证明它们是独立瓶颈           |
| TODO 21                     | 保留，而且应先于新一轮优化开工                     |

---

## 四、参考上游

### Cesium

- `packages/engine/Source/Scene/Cesium3DTileset.js`
- `packages/engine/Source/Scene/Cesium3DTilesetCache.js`
- `packages/engine/Source/Scene/QuadtreePrimitive.js`
- `packages/engine/Source/Scene/TileReplacementQueue.js`
- `packages/engine/Source/Core/RequestScheduler.js`

### MapLibre

- `src/geo/projection/covering_tiles.ts`
- `src/tile/tile_manager.ts`
- `src/source/vector_tile_source.ts`
- `src/source/worker_tile.ts`
- `src/data/feature_index.ts`
- `src/symbol/collision_index.ts`
- `src/symbol/placement.ts`
- `src/style/pauseable_placement.ts`
- `src/style/style_layer_index.ts`

**最后更新时间**：2026-04-15
**整理原则**：只保留仍然需要补齐的主链路，已存在的 helper / cache / pool 不再重复列入 TODO
