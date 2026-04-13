# Cesium-MVT 开发路线图

## 一、架构分析结论 (2026-04-13)

基于对当前实现的深度分析，以及与 Cesium ImageryProvider 和 MapLibre GL JS 源码的对比，以下是核心结论：

### 1.1 与 MapLibre/Cesium 思路一致性

| 维度 | MapLibre/Cesium 做法 | 当前实现 | 一致性 |
|------|---------------------|---------|--------|
| **瓦片选择** | Cesium: SSE 多LOD混合；MapLibre: 视口覆盖 | 单层估算 | ⚠️ 简化 |
| **请求去重** | MapLibre: WorkerTile 状态机 | SourceCache 状态机 | ✅ 一致 |
| **Bucket 编译** | MapLibre: Worker 池 → Bucket | 单 Worker → BucketBuilder | ⚠️ 单实例 |
| **样式求值** | MapLibre: 预编译 AST | 运行时递归遍历 | ❌ 不一致 |
| **Fallback** | Cesium: 祖先瓦片过渡 | 祖先瓦片显示 | ✅ 一致 |
| **缓存策略** | Cesium: 字节级 LRU | 自实现 LRU (256MB) | ✅ 一致 |
| **渲染集成** | Cesium: ImageryLayer 基础设施 | PrimitiveCollection | ⚠️ 未复用 |
| **Layer 分组** | MapLibre: 逐 layer 处理 | LayerFamily 合并 | ✅ 优化合理 |

### 1.2 严重违规（造轮子）

以下模块未复用已依赖库的现有功能，属于违规实现：

| 编号 | 模块 | 当前实现 | 应使用的库 | 行数 | 严重度 |
|------|------|---------|-----------|------|--------|
| **W1** | 表达式求值器 | 自实现 600+ 行递归求值 | `@maplibre/maplibre-gl-style-spec` 的 `createExpression()` + `StyleExpression` | ~600 | 🔴 |
| **W2** | Feature Filter | 自实现 filter 解析 | `@maplibre/maplibre-gl-style-spec` 的 `convertFilter` + `createExpression` | ~150 | 🔴 |
| **W3** | 样式属性求值器 | 自实现 zoom/property/identity 函数 | `@maplibre/maplibre-gl-style-spec` 的 `StyleExpression.evaluate()` | ~200 | 🔴 |

**关键发现**：
- `layer-style-resolver.ts` 已实现但 **未被任何模块调用**
- `feature-filter.ts` 已实现但 **未在 bucket 编译中使用**
- `request-scheduler.ts` 已定义但 **SourceCache 直接用 fetch()**
- 表达式/过滤器/resolver 三个模块形成了"孤岛代码"

### 1.3 性能瓶颈

| 编号 | 问题 | 位置 | 影响 | 优先级 |
|------|------|------|------|--------|
| **P1** | 单层 LOD，不支持多LOD混合 | `view-state.ts` | 远距离过采样，近距离欠采样 | 🔴 P0 |
| **P2** | 表达式运行时求值（即使修复W1后也需预编译） | `expression-evaluator.ts` | 每瓦片×每图层重复遍历AST | 🔴 P0 |
| **P3** | 样式 resolver 未被调用，所有样式用静态值 | `material-cache.ts` | 数据驱动样式完全不工作 | 🔴 P0 |
| **P4** | 单 Worker 实例 | `bucket-tile-dispatcher.ts` | 多核CPU利用率低 | 🟡 P1 |
| **P5** | BucketBuilder 使用 number[] 中间态再转 TypedArray | 所有 builder | 双份内存，GC压力大 | 🟡 P1 |
| **P6** | 每帧 `getAllKeys()` 全量遍历 | `coordinator.ts` | O(n) 扫描已渲染瓦片 | 🟡 P1 |

### 1.4 欠缺核心功能

| 编号 | 功能 | MapLibre实现 | 当前状态 | 工作量 | 优先级 |
|------|------|-------------|---------|--------|--------|
| **M1** | Symbol/Text渲染 | SDF字形+碰撞检测+布局 | 完全缺失 | 3-4周 | 🔴 P0 |
| **M2** | 数据驱动样式 | DDSL完整支持 | 未接入渲染链路 | 1-2周 | 🔴 P0 |
| **M3** | 多LOD混合 | Cesium SSE机制 | 单层选择 | 2-3周 | 🟡 P1 |
| **M4** | Fill Extrusion | 3D建筑渲染 | 完全缺失 | 2-3周 | 🟡 P1 |
| **M5** | Line Dash/Pattern | LineAtlas纹理 | 仅支持实线 | 1-2周 | 🟡 P1 |
| **M6** | Feature Query | KDBush空间索引 | 有FeatureIndex但未使用 | 1周 | 🟢 P2 |

---

## 二、架构重构计划

### 2.1 消除造轮子（必须执行）

#### 任务 1：迁移到 @maplibre/maplibre-gl-style-spec 表达式系统

**目标**：删除 `expression-evaluator.ts`、`feature-filter.ts`、`style-property-evaluator.ts` 三个文件，改用官方库。

**步骤**：

1. 研究 `@maplibre/maplibre-gl-style-spec` 的 API：
   - `createExpression(expression, type)` → 预编译为 `StyleExpression`
   - `StyleExpression.evaluate(context)` → 运行时求值
   - `convertFilter(filter)` → 转换为表达式

2. 重构样式解析流程：
   ```
   样式加载 → 预编译所有表达式 → 存储 StyleExpression 对象
                                    ↓
   Bucket编译 → 使用预编译的表达式求值 → 生成数据驱动样式
   ```

3. 删除文件：
   - `src/mvt/style/expression-evaluator.ts` (~600行)
   - `src/mvt/style/feature-filter.ts` (~150行)
   - `src/mvt/style/style-property-evaluator.ts` (~200行)

4. 重构 `layer-style-resolver.ts`：
   - 使用 `createExpression` 预编译 paint 属性
   - 在 bucket 编译阶段调用 resolver
   - 将求值结果传入渲染后端

5. 重构 `material-cache.ts`：
   - 材质缓存 key 改为 `(layer, zoom)` 而非 `(style, layer)`
   - 支持数据驱动样式的动态材质更新

**验收标准**：
- [ ] 表达式求值使用 `@maplibre/maplibre-gl-style-spec`
- [ ] 表达式在样式加载时预编译
- [ ] Feature filter 在 bucket 编译中生效
- [ ] 数据驱动样式能在渲染中动态变化

---

#### 任务 2：启用 request-scheduler

**目标**：让 `SourceCache` 使用 `scheduleTileRequest()` 而非直接 `fetch()`。

**步骤**：

1. 在 `SourceCache.requestTile()` 中调用 `scheduleTileRequest()`
2. 传入 Cesium `Request` 对象，支持优先级和取消
3. 配置 `throttle: true` 和 `throttleByServer: true`

**验收标准**：
- [ ] 瓦片请求经过 Cesium RequestScheduler
- [ ] 支持请求优先级
- [ ] 支持服务器端节流

---

### 2.2 性能优化

#### 任务 3：样式预编译 + 材质缓存

**目标**：表达式和 paint 属性在样式加载时预编译，避免运行时重复求值。

**步骤**：

1. 在 `StyleManager.updateStyle()` 时：
   - 遍历所有 layer 的 paint 属性
   - 使用 `createExpression()` 预编译每个属性
   - 存储 `StyleExpression` 对象到 layer 缓存

2. 在 `RenderManager.updateLayerFamilies()` 时：
   - 为每个 layerFamily 预计算 layer order Map
   - 缓存 `(layerId, index)` 映射，避免每瓦片重建

3. 在 bucket 编译阶段：
   - 调用 `layer-style-resolver` 获取样式值
   - 将样式值传入渲染后端创建 Material

4. 材质缓存优化：
   - Key 改为 `(layerId, zoomLevel)`
   - 同一 layer 在不同 zoom 可有不同的材质

**验收标准**：
- [ ] 样式加载时完成表达式预编译
- [ ] Bucket 编译时使用预编译表达式
- [ ] 材质按 (layer, zoom) 缓存
- [ ] 每帧不再重复求值静态样式

---

#### 任务 4：BucketBuilder 性能优化

**目标**：消除 number[] 中间态，直接使用 TypedArray。

**步骤**：

1. `FillBucketBuilder` / `LineBucketBuilder` / `CircleBucketBuilder`：
   - 预分配 TypedArray 缓冲区（初始容量）
   - 容量不足时 2x 扩容
   - `build()` 时 slice 到精确大小

2. 消除 `properties: { ...feature.properties }` 浅拷贝：
   - 直接引用 `feature.properties`（只读）
   - 如需修改，在明确需要的地方才拷贝

3. `LineBucketBuilder` 临时数组优化：
   - 直接在主数组上操作
   - 无效时用长度回滚而非预拷贝

**验收标准**：
- [ ] Builder 不使用 number[] 中间态
- [ ] 内存占用降低 30-50%
- [ ] GC 频率降低

---

#### 任务 5：Worker 池

**目标**：支持 4-8 个 Worker 实例，Round-Robin 分发任务。

**步骤**：

1. 重构 `WorkerDispatcher`：
   - 支持 Worker 池配置
   - Round-Robin 或负载感知分发
   - 任务取消时通知正确 Worker

2. 修改 `BucketTileDispatcher`：
   - 初始化时创建 Worker 池
   - 编译任务分发到空闲 Worker
   - 支持任务优先级

3. 修改 `FeatureTileDispatcher`（如使用）：
   - 同样支持 Worker 池

**验收标准**：
- [ ] 支持配置 Worker 数量
- [ ] 多核 CPU 利用率提升
- [ ] 编译吞吐量提升 2-4x

---

### 2.3 核心功能开发

#### 任务 6：多 LOD 混合渲染

**目标**：参考 Cesium 的 SSE（Screen Space Error）机制，支持同一视图内不同 LOD 瓦片混合渲染。

**步骤**：

1. 重构 `view-state.ts`：
   - 实现基于相机距离的 LOD 估算
   - 支持多层级瓦片选择
   - 计算屏幕空间误差阈值

2. 重构 `tile-selection.ts`：
   - 支持多LOD瓦片同时存在
   - 根据 SSE 决定每个区域的 LOD
   - Fallback 逻辑适配多LOD

3. 修改 `render-manager.ts`：
   - 支持不同 LOD 瓦片同时渲染
   - 避免 LOD 切换时的闪烁

**验收标准**：
- [ ] 近距离使用高 LOD
- [ ] 远距离使用低 LOD
- [ ] 同一视图内多LOD混合渲染
- [ ] LOD 切换无闪烁

---

#### 任务 7：Symbol 文本渲染（分阶段）

**阶段 1：基础文本渲染（无碰撞检测）**

1. 创建 `SymbolBucketBuilder`：
   - 解析 `text-field`、`text-size`、`text-font` 等属性
   - 加载字体（使用 `@mapbox/tiny-sdf`）
   - 构建 SDF 字形图集

2. 创建 `bucket-symbol-backend.ts`：
   - 使用 Cesium `Text` 或自定义 DrawCommand
   - 支持文本颜色、大小、锚点

3. 文本布局：
   - 基础文本整形（Shaping）
   - 文本定位
   - 锚点计算

**阶段 2：图标渲染**

1. 精灵管理器：
   - 加载 sprite 图集
   - 解析 sprite 元数据
   - 提供图标坐标

2. `icon-image` 渲染：
   - 图标定位
   - 图标旋转
   - 图标缩放

**阶段 3：碰撞检测**

1. 碰撞索引：
   - 网格空间索引（参考 MapLibre CollisionIndex）
   - 碰撞框计算
   - 优先级排序

2. 跨瓦片符号稳定性：
   - 符号位置不随瓦片加载/卸载抖动
   - 使用 feature ID 作为稳定因子

**验收标准**：
- [ ] 支持地名、道路名标注
- [ ] 支持 POI 图标
- [ ] 碰撞检测避免重叠
- [ ] 跨瓦片符号稳定

---

#### 任务 8：数据驱动样式接入

**目标**：让 `layer-style-resolver.ts` 在 bucket 编译中生效。

**步骤**：

1. 在 `bucket-tile-compiler.ts` 中：
   - 为每个 feature 创建样式上下文
   - 调用 `layer-style-resolver` 获取样式值
   - 将样式值传入 bucket builder

2. 修改 bucket builder：
   - `addFeature()` 接受样式上下文
   - 根据样式值设置颜色、大小等属性

3. 修改渲染后端：
   - 支持 per-feature 样式
   - 或使用 uniform 传递动态样式值

**验收标准**：
- [ ] `layer-style-resolver` 被调用
- [ ] 数据驱动样式生效
- [ ] 支持 zoom 函数
- [ ] 支持属性函数

---

## 三、代码质量改进

### 3.1 清理孤岛代码

| 文件 | 当前状态 | 动作 |
|------|---------|------|
| `layer-style-resolver.ts` | 已实现但未使用 | 接入 bucket 编译链路 |
| `feature-filter.ts` | 已实现但未使用 | 接入 bucket 编译链路 |
| `request-scheduler.ts` | 已定义但未使用 | 接入 SourceCache |
| `feature-tile.ts` | 功能重叠 | 评估是否合并到 bucket-tile |
| `feature-tile-dispatcher.ts` | 功能重叠 | 评估是否合并到 bucket-tile |

### 3.2 命名规范修正

| 当前命名 | 建议命名 | 原因 |
|---------|---------|------|
| `tileWidth` (TileScheduler) | `viewportTilePixelSize` | 语义更清晰 |
| `styleEpoch` vs `epoch` | 统一为 `styleEpoch` | 命名一致 |
| `createScopedRenderTileKey` vs `resolveRenderTileKey` | 统一为 `createRenderTileKey` | 功能相似 |
| `compileBucketTileFromData` | `compileBucketTileFromRaw` | 与 `compileBucketTileFromParsed` 区分 |
| `createBucketRenderedTileHandle` | `createRenderedTileHandle` | 上下文中无需 bucket 前缀 |

### 3.3 架构约束

- **Buffer\*Collection API**：这是项目的技术选型，其能力边界即为项目边界。尊重并适配，不寻求替代方案。
- **不贴地**：明确决策，不作为待办项。
- **LayerFamily 合并**：这是合理的优化，保留并完善。

---

## 四、优先级排序

### P0 - 必须执行（本周-下周）

1. 🔴 迁移到 `@maplibre/maplibre-gl-style-spec` 表达式系统（消除 W1/W2/W3）
2. 🔴 启用数据驱动样式（让 resolver 生效）
3. 🔴 样式预编译 + 材质缓存优化

### P1 - 重要功能（1-2月）

4. 🟡 Worker 池实现
5. 🟡 BucketBuilder 性能优化（TypedArray 直接写入）
6. 🟡 多 LOD 混合渲染
7. 🟡 Symbol 文本渲染（阶段 1+2）

### P2 - 完善功能（3-6月）

8. 🟢 Symbol 碰撞检测（阶段 3）
9. 🟢 Line Dash/Pattern 支持
10. 🟢 Fill Extrusion（3D 建筑）
11. 🟢 Feature Query API

### P3 - 长期优化

12. 样式热更新（diff 算法）
13. 性能监控面板
14. 交互功能（点击/悬停/Popup）

---

## 五、里程碑规划

### Milestone 1: 架构合规 ✅ 基础完成

- [x] 表达式求值系统（自实现版本）
- [x] Feature Filter（自实现版本）
- [x] 请求调度器定义

### Milestone 2: 消除造轮子（目标：复用官方库）

- [ ] 迁移到 `@maplibre/maplibre-gl-style-spec` 表达式
- [ ] 删除自实现表达式/过滤器/求值器
- [ ] 启用 request-scheduler
- [ ] 数据驱动样式接入

### Milestone 3: 性能优化（目标：流畅渲染）

- [ ] 样式预编译 + 材质缓存
- [ ] BucketBuilder 性能优化
- [ ] Worker 池
- [ ] 多 LOD 混合

### Milestone 4: 功能完整（目标：支持完整地图）

- [ ] Symbol 文本渲染
- [ ] 碰撞检测
- [ ] Line Dash/Pattern
- [ ] Feature Query

### Milestone 5: 生产就绪（目标：性能和稳定性）

- [ ] 性能监控
- [ ] 内存管理
- [ ] 错误处理
- [ ] 文档完善

---

## 六、技术债务

### 6.1 代码质量

- [ ] 添加更多代码注释（解释为什么，而非是什么）
- [ ] 统一错误处理
- [ ] 添加日志系统
- [ ] 代码覆盖率提升

### 6.2 类型安全

- [ ] 完善 TypeScript 类型定义
- [ ] 消除 any 类型
- [ ] 添加类型守卫

### 6.3 测试补充

- [ ] Symbol 布局测试
- [ ] 碰撞检测测试
- [ ] 缓存淘汰测试
- [ ] 内存泄漏测试
- [ ] 大数据量性能测试

---

## 七、参考文档

- [架构分析报告](./.archive/mvt-analysis-report.md) - 完整的架构分析和对比
- [AGENTS.md](./AGENTS.md) - 开发规范
- [MapLibre GL JS Architecture](https://github.com/maplibre/maplibre-gl-js/blob/main/ARCHITECTURE.md)
- [Cesium ImageryProvider Documentation](https://cesium.com/learn/cesiumjs/ref-doc/ImageryProvider.html)
