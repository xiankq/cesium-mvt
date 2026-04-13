# MVT 渲染实现深度分析报告

## 一、当前实现的 MVT 请求-缓存-调度-渲染流程分析

### 1.1 整体架构流程

```
视图状态收集 → 瓦片选择 → 请求调度 → 数据加载 → Worker编译 → Bucket构建 → Cesium渲染
     ↓            ↓          ↓          ↓           ↓           ↓           ↓
 ViewState    TileSelection  Request   VectorTile  Worker     Builders   Primitives
```

### 1.2 核心流程详解

#### 1.2.1 请求阶段 (Request Phase)

**实现位置**: `source-manager.ts`, `tile-request.ts`, `request-scheduler.ts`

**流程**:

1. `CesiumVectorTileCoordinator.update()` 每帧被调用
2. `TileScheduler.schedule()` 收集当前视图可见的瓦片坐标
3. `processTileSelection()` 将瓦片分为四类:
   - `readyCoordinates`: 已就绪可直接渲染
   - `fallbackCoordinates`: 使用父瓦片降级显示
   - `requestCoordinates`: 需要发起网络请求
   - `emptyCoordinates`: 已加载但无数据

**关键代码路径**:

```
coordinator.update()
  → scheduler.schedule(camera, viewportWidth)
  → processTileSelection(coordinates)
    → resolveSourceTiles() // 分类瓦片
    → requestTile() // 发起请求
      → sourceManager.requestTile()
        → sourceCache.requestTile() // 网络请求
        → bucketTileDispatcher.compile() // Worker 编译
```

#### 1.2.2 缓存阶段 (Cache Phase)

**实现位置**: `tile-cache-manager.ts`, `tile-cache.ts`

**策略**:

- LRU (Least Recently Used) 淘汰算法
- 默认缓存容量: 256MB
- 按字节大小控制 (`maxBytes`)
- 支持 pending 请求去重

**缓存键设计**:

```typescript
// 带 style epoch 的键，确保样式变更后旧缓存失效
key = `${styleEpoch}:${sourceId}/${level}/${x}/${y}`;
```

#### 1.2.3 调度阶段 (Scheduling Phase)

**实现位置**: `tile-scheduler.ts`, `tile-selection.ts`, `view-state.ts`

**调度逻辑**:

1. **视图覆盖计算**: `collectSceneViewTileSelection()`
   - 使用 `camera.computeViewRectangle()` 获取视口矩形
   - 根据视口宽度估算最优瓦片层级
   - 生成覆盖瓦片坐标列表

2. **层级估算算法**:

```typescript
const approximateLevel = Math.floor(Math.log2(
  (viewportWidth * tilingScheme.rectangle.width)
  / (viewRectangle.width * tileWidth * levelZeroTiles)
));
```

3. **Fallback 机制**:
   - 当目标瓦片未就绪时，向上查找祖先瓦片
   - 检查祖先瓦片是否被已解析的后代完全覆盖
   - 避免不必要的降级显示

#### 1.2.4 渲染阶段 (Render Phase)

**实现位置**: `render-manager.ts`, `bucket-rendered-tile.ts`, `backend/*.ts`

**渲染管线**:

```
RenderTile (渲染计划)
  ↓ Worker 编译
ParsedTileResult (Bucket 数据)
  ↓ 创建 Handle
BucketRenderedTileHandle
  ↓ 挂载到 Cesium
BufferPolygonCollection / BufferPolylineCollection / BufferPointCollection
```

**几何处理流程**:

1. **Fill**: 瓦片坐标 → 投影 → earcut 三角剖分 → 网格细分 → Cartesian3
2. **Line**: 瓦片坐标 → 投影 → 弦误差细分 → Cartesian3
3. **Circle**: 瓦片坐标 → 投影 → Cartesian3 (点精灵)

---

## 二、与 Cesium 和 MapLibre 源码思路对比分析

### 2.1 Cesium ImageryProvider 架构对比

#### 2.1.1 一致之处

| 特性         | Cesium 原生             | 当前实现                   | 一致性评价          |
| ------------ | ----------------------- | -------------------------- | ------------------- |
| 瓦片选择策略 | QuadtreePrimitive       | estimateViewTileLevel()    | ✅ 思路一致，但简化 |
| 请求去重     | RequestScheduler        | pendingRequests Map        | ✅ 实现正确         |
| LOD 管理     | Screen space error      | 视口宽度估算               | ⚠️ 简化实现         |
| 生命周期     | load → process → update | schedule → request → mount | ✅ 状态机清晰       |

#### 2.1.2 不一致之处

| 问题           | Cesium 实现                 | 当前实现           | 影响          |
| -------------- | --------------------------- | ------------------ | ------------- |
| **多源支持**   | 单 ImageryProvider 单数据源 | 支持多 Source 协调 | ❌ 过度设计   |
| **贴地渲染**   | Height sampling             | 固定高度偏移       | ✅ 明确不支持 |
| **请求优先级** | 基于屏幕覆盖率              | 简单并发控制       | ⚠️ 不够精细   |
| **瓦片过渡**   | Fade-in/out 动画            | 无过渡             | ⚠️ 视觉突兀   |
| **内存管理**   | TileProvider 自动回收       | 手动 LRU 管理      | ⚠️ 需优化     |

### 2.2 MapLibre GL JS 架构对比

#### 2.2.1 核心架构差异

| 模块            | MapLibre GL JS                   | 当前实现                                               | 差异分析                  |
| --------------- | -------------------------------- | ------------------------------------------------------ | ------------------------- |
| **数据流**      | Source → Tile → Bucket → Program | Source → Tile → RenderTile → Bucket → Cesium Primitive | ❌ 多一层 RenderTile 抽象 |
| **样式求值**    | 编译时求值 + 运行时插值          | 完全运行时求值                                         | ⚠️ 性能较差               |
| **Worker 模型** | 固定 Worker 池                   | 单 Worker 实例                                         | ❌ 并发度低               |
| **Bucket 合并** | 按 zoom level 合并               | 每瓦片独立                                             | ❌ Draw call 多           |
| **碰撞检测**    | Grid-based spatial index         | 未实现                                                 | ❌ Symbol 缺失            |

#### 2.2.2 冗余优化识别

**冗余 1: RenderTile 中间表示**

```typescript
// 当前实现：两层抽象
RenderTile (渲染计划) → ParsedTileResult (编译后) → Handle (Cesium)

// MapLibre 实现：一层抽象
Tile → Bucket → Program
```

**问题**:

- `RenderTile` 仅包含 `geometryBatches` 元数据，未缓存几何数据
- 每次请求瓦片都要重新创建 `RenderTile` 对象
- 增加了不必要的对象分配和 GC 压力

**建议**:

- 合并 `RenderTile` 和 `ParsedTileResult`
- 或将其缓存，避免重复创建

**冗余 2: 双层 Key 系统**

```typescript
// 当前实现
sourceTileKey = `${sourceId}/${level}/${x}/${y}`
renderTileKey = `${sourceId}/${level}/${x}/${y}@${styleEpoch}`

// 问题
- sourceManager 使用 sourceTileKey
- renderManager 使用 renderTileKey
- cacheManager 使用 renderTileKey
```

**问题**:

- 同一瓦片在不同系统中有不同键
- 样式变更后旧键缓存无法命中
- 增加键解析复杂度

**建议**:

- 统一使用单一键，在需要的地方添加 epoch 修饰

**冗余 3: Style Epoch 全量失效**

```typescript
// 样式更新时
updateStyle(style) {
  this.styleEpoch += 1;
  this.sourceManager.abortAll();        // 中止所有请求
  this.cacheManager.clear(true);        // 清空缓存
  this.renderManager.clear();           // 清空渲染
  this.scheduler.invalidate();          // 重置调度
}
```

**MapLibre 做法**:

- 仅对变更的 layer 重新编译 bucket
- 使用 style diff 算法增量更新
- 缓存未变更的 tile bucket

**影响**:

- 样式切换时所有瓦片闪烁
- 大量重复请求和重复编译
- 网络带宽浪费

---

## 三、当前实现的性能问题分析

### 3.1 关键性能瓶颈

#### 3.1.1 样式求值性能 🔴 严重

**问题位置**: `material-cache.ts`, `expression-evaluator.ts`

**现状**:

```typescript
// 每个瓦片、每个图层都重新求值
for (const layerId of bucket.layerIds) {
  const layer = layersById.get(layerId);
  const material = getFillMaterial(style, layer); // 重复创建
}
```

**性能影响**:

- 每个瓦片 × N 个图层 = N 次表达式求值
- 视图内 100 个瓦片 × 10 个图层 = 1000 次/帧
- 表达式 AST 解析未缓存

**优化建议**:

1. 编译期求值静态表达式
2. 按 `(layer, zoom)` 缓存材质
3. 批量求值同类型特征

#### 3.1.2 Worker 单实例瓶颈 🟡 中等

**问题位置**: `bucket-tile-dispatcher.ts`

**现状**:

```typescript
function createDefaultWorker() {
  return new Worker(
    new URL('../worker/bucket-tile.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
```

**性能影响**:

- 单个 Worker 阻塞时，后续瓦片排队等待
- 多核 CPU 利用率低
- 编译延迟随瓦片数量线性增长

**MapLibre 对比**:

```javascript
// MapLibre 使用 Worker 池
const numWorkers = Math.min(
  navigator.hardwareConcurrency || 1,
  4
);
this.workers = new Array(numWorkers);
```

**优化建议**:

1. 实现 Worker 池 (4-8 个实例)
2. 使用 Round-Robin 或负载感知分发
3. 支持取消优先级高的请求

#### 3.1.3 内存管理缺陷 🟡 中等

**问题位置**: `bucket-*-builder.ts`

**现状**:

```typescript
// 每帧创建临时数组
private positions: number[] = [];
private triangles: number[] = [];
// 构建后转换为 TypedArray
const data: FillBucketData = {
  positions: new Float64Array(this.positions),
  triangles: new Uint32Array(this.triangles),
};
```

**性能影响**:

- 频繁的数组拷贝和转换
- GC 压力大 (视图内数百个瓦片)
- 内存碎片化

**优化建议**:

1. 使用对象池复用 builder 实例
2. 预分配 TypedArray 缓冲区
3. 流式写入避免中间数组

#### 3.1.4 投影计算重复 🟢 轻微

**问题位置**: `tile-projection.ts`

**现状**:

```typescript
// 每个顶点调用一次 projectTilePoint
function projectPoint(point: TilePoint): Cartesian3 {
  return projectTilePoint(point, this.extent, this.projectionContext);
}

// subdivideTriangleEdges 内部再次调用
for (const point of tilePoints) {
  const projected = projectPoint(point);
}
```

**性能影响**:

- 同一瓦片的边界顶点被重复投影
- 相邻瓦片共享边界重复计算
- WebMercator 反投影开销未优化

**优化建议**:

1. 缓存已投影顶点 (按 extent 坐标 hash)
2. 预计算瓦片四角的世界坐标
3. 使用双线性插值内部点

### 3.2 渲染性能问题

#### 3.2.1 Draw Call 过多

**问题**: 每个瓦片 × 每个图层 = 独立 Primitive

```typescript
// render-manager.ts
for (const layerId of bucket.layerIds) {
  const collection = new BufferPolygonCollection(...); // 每层一个
  collections.push({ collection, layerId });
}
```

**影响**:

- 100 瓦片 × 5 图层 = 500 Draw Calls
- Cesium Primitive 管理开销
- GPU 状态切换频繁

**MapLibre 优化**:

- 按 `(source, type, zoom)` 合并 bucket
- 使用单一 Program 批量绘制
- 通过 `gl.drawElements` 偏移区分图层

**建议**:

1. 跨瓦片合并同类型 bucket
2. 使用 `gl.MULTI_DRAW_INDIRECT` (WebGL2)
3. 或至少按图层分组

#### 3.2.2 无层级细节 (LOD) 控制

**问题**: 所有可见瓦片使用相同 granularity

```typescript
// fill-bucket-builder.ts
this.granularity = options.zoom !== undefined
  ? getGranularityForZoomLevel(options.zoom)
  : DEFAULT_GRANULARITY;
```

**影响**:

- 远距离瓦片细分过度
- GPU 渲染冗余三角形
- 内存占用不必要增加

**Cesium 做法**:

- 根据屏幕空间误差动态细分
- 远距离使用粗糙网格
- 近距离使用精细网格

**建议**:

1. 实现屏幕空间误差估算
2. 根据相机距离选择 granularity
3. 支持运行时降级

---

## 四、基于 MapLibre 源码欠缺的 MVT 功能分析

### 4.1 核心缺失功能 (P0 - 必须实现)

#### 4.1.1 Symbol 图层渲染 ❌ 完全缺失

**MapLibre 实现**:

- `src/symbol/` 模块 (~3000 行)
- SDF (Signed Distance Field) 字形渲染
- 精灵图集 (Sprite Atlas) 管理
- 碰撞检测 (CollisionBox + CollisionIndex)
- 文本整形 (Text Shaping)
- 跨瓦片符号稳定性 (Cross-Tile Symbol Stability)

**当前状态**: 完全未实现

**影响**:

- ❌ 无法显示地名标注
- ❌ 无法显示道路名称
- ❌ 无法显示 POI 图标
- ❌ 无法显示注记

**工作量估算**: 2-3 人月

#### 4.1.2 碰撞检测系统 ❌ 完全缺失

**MapLibre 实现**:

```javascript
// CollisionIndex
grid = new Grid(bbox, cellSize);
grid.insert(collisionBox);
// 查询碰撞
hasCollision = grid.query(bbox);
```

**当前状态**: 未实现

**影响**:

- ❌ 符号重叠无法避免
- ❌ 标注密度高时遮挡严重
- ❌ 无法实现优先级排序

**依赖**: Symbol 渲染完成后才能实现

#### 4.1.3 线型样式 (Dash/Gap) ❌ 部分缺失

**MapLibre 实现**:

- `LineAtlas` 管理 dash pattern
- 运行时生成 dash 纹理
- 支持 `line-dasharray`, `line-gap-width`

**当前状态**:

- ❌ 不支持 `line-dasharray`
- ❌ 不支持 `line-gap-width`
- ❌ 不支持 `line-pattern` (纹理填充)
- ✅ 支持 `line-color`, `line-width`

**影响**:

- ❌ 虚线道路无法显示
- ❌ 铁路、边界等特殊线型缺失

### 4.2 中等优先级缺失 (P1 - 重要功能)

#### 4.2.1 填充图案 (Fill Pattern) ❌ 缺失

**MapLibre 实现**:

- `PatternManager` 管理纹理
- `fill-pattern` 属性支持
- 图案跨瓦片对齐

**当前状态**: 仅支持纯色填充

#### 4.2.2 3D 建筑渲染 (Fill Extrusion) ❌ 缺失

**MapLibre 实现**:

- `fill-extrusion` 图层类型
- 基于 `fill-extrusion-height` 拉伸
- 侧面 + 顶面渲染

**当前状态**: 未实现

#### 4.2.3 图层可见性表达式 ⚠️ 部分实现

**当前实现**:

```typescript
// isLayerVisibleAtZoom()
// 仅检查 minzoom/maxzoom
```

**缺失**:

- ❌ `layout.visibility` 表达式
- ❌ 运行时属性过滤
- ❌ Zoom 函数动态可见性

#### 4.2.4 Heatmap 图层 ❌ 缺失

**MapLibre 实现**:

- `heatmap` 图层类型
- 核密度估计算法
- 颜色插值

**当前状态**: 未实现

### 4.3 低优先级缺失 (P2 - 优化项)

#### 4.3.1 样式热更新 ❌ 全量替换

**当前问题**:

```typescript
updateStyle(style) {
  this.sourceManager.abortAll();   // 全量中止
  this.cacheManager.clear(true);   // 全量清空
  this.renderManager.clear();      // 全量移除
}
```

**MapLibre 做法**:

- Style diff 算法
- 增量更新变更的 layer
- 保留未变更的 tile bucket

#### 4.3.2 Feature Query API ❌ 缺失

**缺失 API**:

- `queryRenderedFeatures(geometry, options)`
- `querySourceFeatures(sourceId, options)`
- 空间索引 (R-Tree / KDBush)

**当前状态**: 有 `FeatureIndex` 但未暴露 API

#### 4.3.3 交互功能 ❌ 缺失

**缺失**:

- Feature 悬停高亮
- 点击事件回调
- Popup 弹出
- 框选查询

#### 4.3.4 性能监控 ❌ 缺失

**缺失**:

- FPS 统计
- 内存使用监控
- Draw Call 统计
- Tile 加载时间分析

### 4.4 架构约束

#### 4.4.1 Buffer\*Collection API

**项目定位**: 这是项目的技术选型，不是技术债务。其能力边界即为项目边界。

**当前限制**:

- 不支持自定义 shader
- 材质能力有限
- API 处于实验阶段

**决策**: 尊重并适配 `Buffer*Collection` 的能力边界，不寻求替代方案。后续功能设计应以此为约束条件。

#### 4.4.2 高度偏移策略

**当前实现**:

```typescript
const LINE_HEIGHT_OFFSET = 1; // 固定 1 米
```

**问题**:

- Z-fighting 风险
- 远距离偏移过大
- 近距离偏移不足

**建议**:

- 基于相机距离动态偏移
- 或使用 `polygonOffset`

---

## 五、改进建议与优先级排序

### 5.1 P0 - 立即修复 (1-2 周)

1. **材质缓存优化**
   - 按 `(layer, zoom)` 缓存材质实例
   - 编译期求值静态表达式
   - 预期收益: 30-50% 渲染提升

2. **Worker 池实现**
   - 4 个 Worker 实例
   - Round-Robin 分发
   - 预期收益: 2-4x 编译吞吐

3. **内存池优化**
   - Builder 对象池复用
   - 预分配 TypedArray 缓冲区
   - 预期收益: 40% GC 减少

### 5.2 P1 - 重要功能 (1-2 月)

4. **Symbol 渲染 (第一阶段)**
   - SDF 字形图集
   - 基础文本布局
   - 无碰撞检测
   - 工作量: 3-4 周

5. **碰撞检测系统**
   - 网格索引
   - 碰撞框计算
   - 优先级排序
   - 工作量: 2-3 周

6. **Line Dash 支持**
   - Line Atlas 实现
   - Dash pattern 生成
   - 工作量: 1-2 周

### 5.3 P2 - 完善功能 (3-6 月)

7. **样式热更新**
   - Style diff 算法
   - 增量 bucket 编译
   - 工作量: 2-3 周

8. **LOD 控制**
   - 屏幕空间误差
   - 动态 granularity
   - 工作量: 2-3 周

9. **Feature Query API**
   - 空间索引
   - queryRenderedFeatures
   - 工作量: 1-2 周

### 5.4 P3 - 长期规划

10. **3D 建筑渲染**
    - Fill Extrusion
    - 高度属性解析

11. **性能监控面板**
    - FPS / 内存 / Draw Call

12. **交互功能**
    - 点击查询
    - Popup 支持

---

## 六、架构对比总结

| 维度            | MapLibre GL JS             | Cesium ImageryProvider | 当前实现                                | 评价          |
| --------------- | -------------------------- | ---------------------- | --------------------------------------- | ------------- |
| **数据流**      | Source→Tile→Bucket→Program | Provider→Tile→Texture  | Source→Tile→RenderTile→Bucket→Primitive | ❌ 过度抽象   |
| **样式求值**    | 编译时+运行时              | N/A                    | 完全运行时                              | ⚠️ 性能差     |
| **Worker 模型** | Worker 池 (4-8)            | N/A (CPU 端)           | 单 Worker                               | ❌ 并发低     |
| **缓存策略**    | 按 tile+zoom 缓存 bucket   | 纹理缓存               | LRU 256MB                               | ✅ 合理       |
| **瓦片选择**    | 屏幕空间误差               | Quadtree               | 视口宽度估算                            | ⚠️ 简化       |
| **贴地渲染**    | 不支持 (2D)                | Height sampling        | 固定偏移                                | ✅ 明确不支持 |
| **Symbol 渲染** | 完整实现                   | N/A                    | 未实现                                  | ❌ 缺失       |
| **碰撞检测**    | Grid 索引                  | N/A                    | 未实现                                  | ❌ 缺失       |
| **LOD 控制**    | 动态细分                   | 层级选择               | 固定 granularity                        | ⚠️ 粗糙       |
| **多源协调**    | 多 Source 支持             | 单 Provider            | 多 Source                               | ✅ 一致       |
| **请求调度**    | 优先级队列                 | RequestScheduler       | 简单并发                                | ⚠️ 基础       |

### 核心结论

**优势**:

- ✅ 多数据源协调机制清晰
- ✅ 瓦片状态机完整 (candidate→selected→shown)
- ✅ Fallback 机制健壮
- ✅ LRU 缓存实现合理

**劣势**:

- ❌ 符号渲染完全缺失 (最严重)
- ❌ 样式求值性能差
- ❌ Worker 单实例瓶颈
- ❌ 无 LOD 控制
- ❌ 内存管理粗糙

**与 MapLibre 不一致之处**:

1. RenderTile 中间抽象层冗余
2. 样式求值时机不当 (应编译期求值静态表达式)
3. Worker 架构过于简单 (应使用池)
4. 缺少 Bucket 合并机制
5. 样式更新全量失效 (应 diff 增量更新)

**与 Cesium 不一致之处**:

1. 未使用屏幕空间误差 (应动态细分)
2. 不贴地形 (明确决策，不实现)
3. 请求优先级简单 (应基于屏幕覆盖率)
4. 缺少瓦片过渡动画

---

## 七、后续行动建议

### 立即行动 (本周)

- [ ] 实现材质缓存 (按 layer+zoom 缓存)
- [ ] 表达式编译期求值优化
- [ ] 添加性能基准测试

### 短期计划 (1 月内)

- [ ] Worker 池实现
- [ ] 内存池优化
- [ ] Symbol 渲染方案设计

### 中期计划 (3 月内)

- [ ] Symbol 渲染实现 (含碰撞检测)
- [ ] Line Dash 支持
- [ ] LOD 控制优化

### 长期规划 (6 月+)

- [ ] 样式热更新 (diff 算法)
- [ ] Feature Query API
- [ ] 性能监控面板
