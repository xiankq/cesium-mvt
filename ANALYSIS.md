# Cesium-MVT 当前问题评估与优先级

## 说明

这份文档基于当前工作区代码状态整理，不再沿用旧版里已经过时或优先级失真的结论。

当前分支里已经做过几项关键修复，因此下面的判断是建立在这些修复已存在的前提上：

- symbol 不再通过全量 `clear()` 后重建 billboard 的方式刷新，而是走 diff/reconcile
- 可见 tile 集已加入父子层级 cover 归一化，避免同一区域父子层级同时显示
- `Viewer` 已切回按需渲染，不再手写 `requestAnimationFrame -> viewer.render()` 常驻循环
- line / circle 在 paint-only 的 zoom 变化下已支持原地更新

因此，像“文字闪烁主因是 symbol 全量 clear”或“多层级 tile 同时可见导致的重复渲染”这类问题，已经不该继续作为当前主优先项。

---

## 一、当前最值得做的事项

### P0. Worker 池并行解码

- **位置**: `src/mvt/worker/client.ts`, `src/mvt/scheduler/scheduler.ts`
- **问题**: 现在仍是单 Worker，tile 解码吞吐受单核限制
- **影响**: 快速缩放/平移时，解码排队明显，tile 切换延迟偏大
- **建议**: 实现 Worker Pool，按 `navigator.hardwareConcurrency` 或固定上限创建 2-4 个 worker，调度器按负载分发任务
- **结论**: 很值得做，优先级高

### P0. 请求可取消

- **位置**: `src/mvt/worker/worker.ts`, `src/mvt/worker/client.ts`, `src/mvt/scheduler/scheduler.ts`
- **问题**: `fetch(job.url)` 没有取消能力，旧 tile 请求即使已过期也会继续跑完
- **影响**: 浪费带宽、CPU 和内存，拖慢新请求
- **建议**: 增加显式取消协议。注意不能简单把 `AbortSignal` 直接穿过 `postMessage`；更稳妥的做法是在 worker 内维护 `requestId -> AbortController`，主线程发送 `decode` / `cancel` 两类消息
- **结论**: 很值得做，和 Worker 池是同一批

### P0. 坐标转换预计算

- **位置**: `src/mvt/render/geometry.ts`
- **问题**: `tilePointToCartesian()` 每个点都重复计算 `nativeRectangle`、比例换算和投影流程
- **影响**: 大 tile 或复杂几何下 CPU 浪费明显
- **建议**: 预计算 tile 级别的变换参数，至少把 `tileXYToNativeRectangle()` 和比例项移到外层；进一步可引入 tile transform context
- **结论**: 低成本高收益，应该尽快做

### P0. 私有 Cesium API 风险防护

- **位置**: `src/mvt/scheduler/source.ts`
- **问题**: 当前依赖 `globe._surface._tilesToRender`
- **影响**: Cesium 升级时很容易失效
- **建议**:
  - 增加访问守卫和降级路径
  - 补回归测试，至少覆盖“可见 tile 集能正常更新”和“无 `_surface` 时不崩”
  - 在文档中明确与 Cesium 版本耦合
- **结论**: 很值得做，不一定马上能替换成公有 API，但至少要把风险包住

### P0. Provider 构造异常时的清理缺口

- **位置**: `src/mvt/provider.ts`
- **问题**: `imageryLayer` add 完之后，`sourceCache` 构造阶段如果抛错，当前不在 `try/catch` 范围内
- **影响**: 可能残留 `imageryLayer` 或部分运行时对象
- **建议**: 把 `imageryLayer`、`sourceCache`、`previewLayer` 的初始化放进统一的构造保护逻辑，失败时做完整回滚
- **结论**: 这是一个真实缺陷，应该优先修

---

## 二、第二优先级

### P1. TextSpriteAtlas 增长无上限

- **位置**: `src/mvt/render/text.ts`
- **问题**: `bucketMap` 和 `layoutCache` 没有上限，也没有淘汰策略
- **影响**: 长时间运行、频繁切样式或大量文本时，内存会持续上涨
- **建议**: 增加总页数上限、LRU 淘汰或按 bucket 维度做冷热回收
- **结论**: 很值得做

### P1. 失败冷却与退避

- **位置**: `src/mvt/scheduler/scheduler.ts`
- **问题**: 当前并不是“内部无限重试”，但也没有失败冷却、退避或临时熔断
- **影响**: 当相机反复请求同一失败 tile 时，会持续重新 schedule
- **建议**: 记录失败次数和最近失败时间，增加冷却窗口与最大重试次数
- **结论**: 值得做，但要把问题描述成“缺少失败策略”，不是“内部死循环重试”

### P1. `syncSceneTiles` 触发频率控制

- **位置**: `src/mvt/scheduler/source.ts`
- **问题**: 仍绑定在 `postRender`，场景有 render 时就会持续同步可见 tile
- **影响**: 有多余 CPU 开销
- **建议**: 基于相机矩阵或视口快照做“显著变化”检测；未变化时跳过同步
- **结论**: 值得做，但因为现在已是按需渲染，紧迫度比以前低

### P1. 默认缓存容量策略

- **位置**: `src/mvt/scheduler/scheduler.ts`
- **问题**: 默认 `cacheSize = 64` 偏保守
- **影响**: 大视野或连续浏览下更容易反复解码
- **建议**: 按设备能力、屏幕尺寸或近期活跃 tile 数动态给默认值
- **结论**: 值得做

### P1. 几何简化

- **位置**: `src/mvt/worker/worker.ts`
- **问题**: 解码后直接使用原始几何，没有 zoom-aware simplification
- **影响**: 高顶点量场景 CPU/GPU 压力偏大
- **建议**: 在 worker 中对 line/polygon 做可控简化，并确保不破坏边界拓扑
- **结论**: 值得做，但应排在 Worker 池、可取消请求、坐标缓存之后

### P1. 最近修复缺少测试

- **位置**: 当前仓库整体
- **问题**: 最近新增的父子 tile cover 归一化、symbol 去重、增量 symbol reconcile 都没有自动化验证
- **影响**: 后续改动很容易把当前好不容易压住的问题重新带回来
- **建议**: 至少补这几类测试：
  - 父子层级 tile cover 选择
  - 跨层级 label 去重
  - symbol rebuild 不再全量清空 runtime
- **结论**: 很值得做

---

## 三、第三优先级或长期事项

### P2. Draw Call 大重构

- **位置**: `src/mvt/render/layer.ts`, `src/mvt/render/symbol.ts`
- **问题**: 当前仍按 tile / layer 拆分出较多 primitive 和 billboard collection
- **影响**: draw call 数量仍然高于 Mapbox / MapLibre 风格的批渲染方案
- **建议**: 长期考虑把 line、circle、fill、symbol 分别改造成更强的全局批处理
- **结论**: 值得做，但属于重构级项目，不应插队到 P0/P1 前面

### P2. Text SDF

- **位置**: `src/mvt/render/text.ts`, `src/mvt/render/symbol.ts`
- **问题**: 当前文本仍是 Canvas 2D 光栅化
- **影响**: 极端缩放下清晰度和内存效率都不如 SDF
- **建议**: 若项目目标是长期逼近 MapLibre 文本质量，再考虑 SDF 字体方案
- **结论**: 有价值，但不是现阶段最划算的投入

### P2. fill-extrusion / fill-pattern / line-cap / line-join

- **问题**: 这些是功能缺口
- **影响**: 会限制样式兼容性和最终视觉效果
- **建议**: 若产品需求明确需要这些能力，再按功能项立项
- **结论**: 它们更像 roadmap，而不是当前质量缺陷

### P2. pickFeatures / 交互查询

- **位置**: `src/mvt/provider.ts`
- **问题**: 当前 `pickFeatures()` 直接返回 `undefined`
- **影响**: 无法通过 provider 层复用 Cesium 标准 feature picking 语义
- **建议**: 如果后续要做点击、悬停、tooltip，可单独设计 pick API
- **结论**: 是功能缺口，不是当前核心缺陷

---

## 四、不建议继续按高优先级处理的旧结论

### 1. “requestImage 返回空白 canvas”

- 这不是 bug，而是当前架构设计
- imagery tile 主要用于驱动 Cesium 的 tile 生命周期；真正的矢量内容渲染在 primitive layer 上
- 除非未来要把矢量内容栅格化进 imagery 贴图，否则不应按缺陷处理

### 2. “LRU 缓存语义错误”

- 当前 `TileCache` 的核心 LRU 行为是成立的
- 真正的问题是：
  - `trim()` 用快照遍历，效率一般
  - 当很多 key 被 `skipEviction` 跳过时，容量可能暂时大于阈值
- 这不是 High 级 correctness bug，更像实现可优化项

### 3. “symbol 层 zoomPaintDependent 硬编码会导致不刷新”

- 这个点有代码味道，但功能影响被当前实现部分覆盖
- symbol 的大量 zoom 相关属性已被并到 `zoomLayoutDependent` 里，因此仍会触发 symbol 刷新
- 如果要改，也应该作为代码清晰度和准确性优化，而不是高危缺陷

### 4. “Text 全量 clear 是当前主问题”

- 这个结论已经过时
- 当前 symbol runtime 已经走 reconcile，不再是最主要痛点

### 5. “多层级 tile 同时可见导致重复渲染”

- 这个问题刚刚修过
- 后续要做的是补测试和继续观察边界数据，不应再把它当作当前主缺陷重复列为最高优先级

---

## 五、旧文档里没写准、但值得补进来的问题

### 1. `featureId` 稳定性假设

- **位置**: `src/mvt/render/label.ts`
- **问题**: 当前跨层级 symbol 去重优先依赖 `featureId`
- **风险**: 如果数据源的 `feature.id` 只是 tile-local，可能出现误去重或漏去重
- **建议**: 验证目标数据源的 `feature.id` 语义；必要时引入更稳的 dedupe key 组合

### 2. `fontStackToCss()` 的 string 分支不够稳

- **位置**: `src/mvt/render/label.ts`
- **问题**: 数组分支会对带空格的字体名加引号，但 string 分支只是 `trim()` 后原样返回
- **影响**: 个别字体串可能被浏览器错误解析
- **建议**: 统一走同一套 quoting 逻辑

### 3. 最近渲染修复缺少回归基线

- **问题**: 当前最大的风险不是“明显旧 bug 没修”，而是“刚修好的链路没有测试保护”
- **建议**: 以最近修复为中心补测试，而不是先扩散到大量新功能

---

## 六、建议的实际实施顺序

1. 修 `MvtImageryProvider` 构造异常清理缺口
2. 做 Worker Pool
3. 做请求取消协议
4. 做坐标转换预计算
5. 给 `TextSpriteAtlas` 加上限和淘汰
6. 给 `scheduler` 增加失败冷却 / 退避
7. 给 `source.ts` 的私有 Cesium API 访问补守卫和测试
8. 给最近的 tile cover / symbol dedupe / symbol reconcile 补测试
9. 再评估几何简化和 draw call 大重构是否还必要

---

## 七、总结

当前最该做的不是继续扩大功能面，而是把这条渲染链路的吞吐、取消、内存上限和回归保护补齐。

如果只选最有价值的一批工作，建议聚焦这 5 项：

- Worker 池
- 可取消请求
- 坐标转换预计算
- Text atlas 内存上限
- 私有 Cesium API 风险防护与测试

这几项做完之后，再决定是否进入“批渲染重构 / SDF 文本 / fill-extrusion”这类更重的工程。
