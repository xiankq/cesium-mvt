# Cesium MVT 向量渲染实现任务清单

## 核心目标

借鉴 MapLibre 在样式解析、tile 生命周期、bucket 化、symbol 布局、碰撞检测、跨 tile 稳定性、缓存与增量更新上的成熟经验，最终收敛出一套以 Cesium 为主导的数据模型和渲染架构。

**核心原则**：

- 以 Cesium 为中心，不把 Cesium 变成"套壳 MapLibre"
- 外部 API 可以长得像 `ImageryProvider`，内部必须以 Cesium 为主
- 不保留双轨实现，实验结束后收敛到单一实现
- 复用 MapLibre 的方法论、数据阶段和局部模块，不直接依赖整套运行时

---

## 当前项目结构

```
src/mvt/
├── cache/
│   └── tile-cache.ts           # LRU 缓存实现
├── render/
│   ├── backend/
│   │   ├── bucket-circle-backend.ts  # Circle 渲染后端
│   │   ├── bucket-fill-backend.ts    # Fill 渲染后端
│   │   ├── bucket-line-backend.ts    # Line 渲染后端
│   │   └── material-cache.ts         # 材质缓存
│   ├── bucket-rendered-tile.ts       # 渲染瓦片句柄管理
│   ├── feature-tile.ts               # Feature 提取
│   ├── render-order.ts               # 渲染顺序
│   └── render-tile.ts                # 渲染瓦片编译
├── source/
│   ├── geojson-source-cache.ts       # GeoJSON 源缓存
│   ├── source-cache.ts               # 向量源缓存
│   ├── tile-manager.ts               # 瓦片状态管理
│   ├── tile-request.ts               # 瓦片请求
│   └── vector-tile.ts                # MVT 解析
├── style/
│   ├── layer-family.ts               # 图层族分组
│   ├── layer-visibility.ts           # 图层可见性
│   ├── style-loader.ts               # 样式加载
│   └── style-set.ts                  # 样式集
├── worker/
│   ├── bucket/
│   │   ├── bucket-types.ts           # Bucket 类型定义
│   │   ├── circle-bucket-builder.ts  # Circle bucket 构建
│   │   ├── fill-bucket-builder.ts    # Fill bucket 构建
│   │   └── line-bucket-builder.ts    # Line bucket 构建
│   ├── geometry/
│   │   ├── grid-subdivision.ts       # 网格细分
│   │   ├── line-subdivision.ts       # 线段细分
│   │   ├── tile-projection.ts        # 瓦片投影
│   │   └── utils.ts                  # 几何工具
│   ├── bucket-tile-compiler.ts       # Bucket 瓦片编译
│   ├── bucket-tile-dispatcher.ts     # Worker 调度器
│   ├── bucket-tile.worker.ts         # Worker 入口
│   ├── feature-tile-compiler.ts      # Feature 瓦片编译
│   ├── feature-tile-dispatcher.ts    # Feature 调度器
│   └── feature-tile.worker.ts        # Feature Worker 入口
├── imagery-provider.ts               # ImageryProvider 门面
├── scene-layer.ts                    # 场景图层核心
├── tile-selection.ts                 # 瓦片选择逻辑
└── view-state.ts                     # 视图状态
```

---

## 阶段 0：定边界与脚手架

### 完成状态：✅ 已完成

- [x] **创建项目目录结构**
- [x] **实现 StyleImageryProvider 基础框架**
  - 接受 style url 或 style json
  - 实现 `requestImage` 返回透明占位图像
  - 维护 `solid_image_cache` 按背景色复用 1x1 图片
  - 对外暴露 `ImageryProvider` 语义
  - 自动注入 circle fallback 图层（用于 symbol 图层的点标记回退）

- [x] **实现 style-loader**
  - 拉取 style json
  - 解析相对路径
  - 补齐 source/sprite/glyph 资源定位
  - 解析 source、sprite、glyph、tilejson

- [x] **实现 scene-layer 基础壳**
  - 初始化到 `scene.primitives`
  - 与 provider 建立引用关系
  - 实现 `preRender` / `postRender` 钩子

- [x] **建立生命周期管理**
  - provider destroy 时释放所有资源
  - 断开 provider 与 viewer/scene 的引用

---

## 阶段 1：基础几何渲染

### 完成状态：✅ 已完成

- [x] **实现 worker tile parse**
  - PBF 解码成 feature
  - 按 style layer family 构建 bucket 中间结果
  - 输出 bucket stats 和 typed arrays
  - 输出不带 WebGL 对象

- [x] **实现 fill/line/circle bucket builder**
  - fill bucket builder（支持 earcut 三角化）
  - line bucket builder（支持线段细分）
  - circle bucket builder

- [x] **实现 globe 投影与几何细分**
  - 所有 line 与 fill 边界在投影到 globe 前做自适应细分
  - 细分条件基于 chord error、角度变化或 screen-space error
  - 同一 tile 边界与相邻 tile 使用一致规则，避免裂缝
  - 边界点吸附机制消除浮点误差

- [x] **实现 Buffer 后端**
  - `BufferPolygonCollection` 承接 fill
  - `BufferPolylineCollection` 承接基础 line
  - `BufferPointCollection` 承接 circle
  - worker 先做统计，主线程一次性按精确容量分配 collection

- [x] **实现 tile buffer 与裁剪策略**
  - parse 保留 buffer 区域几何
  - render 视需要在 tile bounds 内裁剪

- [x] **实现 background 处理**
  - 通过 StyleSet 提取背景色
  - ImageryProvider 返回背景色填充的 1x1 图像

---

## 阶段 2：缓存、查询、增量更新

### 完成状态：🔄 部分完成

- [x] **实现 tile cache 系统**
  - `TileCache` 类实现 LRU 缓存
  - 支持动态缓存大小计算（基于视口大小）
  - 支持 touch、add、delete、clear 操作

- [x] **实现 LRU 与 trim 机制**
  - 每帧开始先把缓存分成"本帧未触达"和"本帧已触达"
  - 选中的 tile 调用 `touch`
  - frame 结束后按内存预算 trim
  - trim 时优先淘汰最久未使用且不阻塞当前显示的 tile

- [ ] **实现 request scheduler**
  - tile、sprite、glyph、tilejson 请求全部进统一调度
  - 优先级按"当前视图是否阻塞渲染"排序
  - 远离视图的请求要及时取消

- [x] **实现请求取消机制**
  - 取消本帧未 `touch` 的 in-flight tile 请求
  - 通过 AbortController 实现请求取消

- [ ] **实现 feature index**
  - `featureId -> feature table entry`
  - `tile + bucket + local feature index -> source feature`

- [ ] **实现 query service**
  - 支持 `pickFeatures` 兼容入口
  - 支持 `scene.pick` 屏幕空间 picking
  - 查询结果统一转成项目自己的 feature info

- [ ] **实现 style diff 与增量更新**
  - paint 变更：只更新材质或 uniform，不重新 parse tile
  - layout 变更：bucket 失效，需要重新 parse / rebuild
  - source/结构变更：source cache 失效，render tile 全量失效
  - 维护 `style-epoch`

---

## 阶段 3：symbol 系统

### 完成状态：❌ 未开始

- [ ] **实现 glyph manager**
- [ ] **实现 sprite manager**
- [ ] **实现 symbol draw command backend**
- [ ] **实现 transform-adapter**
- [ ] **实现 placement 系统**
- [ ] **实现 symbol visibility 分析**

---

## 阶段 4：复杂样式与 Cesium 强化

### 完成状态：❌ 未开始

- [ ] **实现自定义 pattern backend**
- [ ] **实现自定义 line shader/backend**
- [ ] **评估 line symbol**
- [ ] **接 terrain**
- [ ] **评估 fill-extrusion**

---

## 核心状态机设计

### Tile 状态定义

已实现显式区分四个概念：

- `candidate`：进入当前帧遍历范围的 tile
- `selected`：当前帧经过可见性分析后，理论上希望用于渲染的 tile
- `shown`：当前帧真正向 Cesium 提交了 command / collection 的 tile
- `touched`：当前帧被使用过、保活过或仍被依赖的 tile

生命周期位：

- `hidden`：当前帧不再 `shown`，但内容仍保留在 cache 中
- `eligible-for-unloading`：当前帧未 `touched` 且无外部占用，才允许真正释放

### Fallback 机制

已实现完整的 fallback 机制：

- **查找策略**：从目标瓦片的父级开始向上查找，跳过 `'empty'` 状态的瓦片，直到找到 `'ready'` 状态的祖先瓦片
- **生命周期**：fallback 瓦片在新瓦片加载期间保持 `shown` 状态，新瓦片加载完成后转为 `hidden`，下一帧才能卸载
- **空瓦片处理**：瓦片加载失败或返回空数据时，创建空的 handle 并标记为 `'empty'`，避免状态一直是 `'missing'`

### 帧内流程

- [x] **begin-frame**
  - 读取 `frameState`
  - 生成 `view-state`
  - 重置所有 tile 的本帧标记

- [x] **collect-candidates**
  - 从 root tile、上帧热 tile、in-flight tile、fallback tile 出发生成候选集

- [x] **compute-visibility**
  - 基于 frustum、horizon/occluder、source rectangle、level 范围计算 tile 是否进入可见遍历

- [x] **select-tiles**
  - 结合 target level、refine 条件、父子 readiness、fallback 策略，确定当前帧 selected set

- [x] **request-and-promote**
  - 对 selected 但未 ready 的 tile 发起请求
  - 对关键祖先与必要 sibling 做低优先级预取

- [x] **placement-and-show**
  - 先做几何层的 show set
  - 再做 symbol placement / collision（未实现）

- [x] **hide-unused**
  - 上帧 `shown` 但本帧未进入 show set 的 tile，先转成 `hidden`

- [x] **touch-retained**
  - 当前帧 `shown` / fallback / 依赖的 tile 必须 `touch`

- [x] **post-frame-trim**
  - 取消本帧未 `touch` 的 in-flight 请求
  - 检查 cache budget
  - 对"未 `touch` 且 `eligible-for-unloading`"的 tile 执行真实 unload

---

## 关键状态分层

当前实现的分层：

- [x] **source tile**：原始请求单元，存放 PBF、TileJSON 元数据（SourceCache）
- [x] **parsed tile**：worker 输出，包含 feature index、bucket stats（ParsedTileResult）
- [x] **render tile**：主线程可渲染单元，持有 Cesium backend 资源句柄（BucketRenderedTileHandle）
- [ ] **placement state**：与当前视图相关，包含 collision、cross-tile ids

---

## 缓存管理

### 已实现的缓存

| 缓存名称                  | 位置                 | 说明                     |
| ------------------------- | -------------------- | ------------------------ |
| `solidImageCache`         | StyleImageryProvider | 背景色 1x1 图像复用      |
| `bucketTileCache`         | SceneLayer           | 解析后的 bucket 数据缓存 |
| `hiddenRenderedTileCache` | SceneLayer           | 隐藏的渲染瓦片缓存       |
| `materialCache`           | material-cache.ts    | 材质缓存（WeakMap）      |

### 缓存策略

- **动态缓存容量**：根据视口大小动态计算缓存容量
- **LRU 淘汰**：基于最近使用时间淘汰
- **内存预算**：按字节大小控制缓存总量

### Provider 作为缓存根对象

所有缓存都以 `StyleImageryProvider` 实例为根对象持有：

- [x] `solid-image-cache`
- [x] `bucket-tile-cache`
- [x] `hidden-rendered-tile-cache`
- [ ] `glyph-atlas-cache`
- [ ] `sprite-atlas-cache`
- [ ] `feature-table-cache`
- [ ] `pick-cache`
- [ ] `request-tracker`
- [ ] `debug-stats`

### 销毁顺序

1. 停止 scene 更新钩子与事件监听
2. 取消 in-flight request 与 worker 任务
3. 释放 draw command / primitive / collection
4. 释放 render tile、parsed tile、raw tile
5. 释放 glyph / sprite / pattern atlas
6. 清空 cache map 与统计对象
7. 断开 provider 到 scene/viewer 的最后引用

---

## 渲染后端分工

| 图层类型           | 推荐后端                      | 实现状态  |
| ------------------ | ----------------------------- | --------- |
| `background`       | scene 背景色或专用全屏 pass   | ✅ 已实现 |
| `fill`             | `BufferPolygonCollection`     | ✅ 已实现 |
| `line` 基础实线    | `BufferPolylineCollection`    | ✅ 已实现 |
| `circle`           | `BufferPointCollection`       | ✅ 已实现 |
| `symbol` 文本/图标 | 自定义 `DrawCommand`          | ❌ 未实现 |
| `line-dasharray`   | 自定义 `DrawCommand`          | ❌ 未实现 |
| `fill-pattern`     | 自定义 `DrawCommand`          | ❌ 未实现 |
| `fill-extrusion`   | 专用 primitive / draw command | ❌ 未实现 |

---

## 可见性分析分层

- [x] **tile visibility**：tile bounds 是否与当前视锥、地平线遮挡、source rectangle 相交
- [x] **render visibility**：该 tile 在当前层级决策下，是否应由自己显示
- [ ] **symbol visibility**：该 tile 内的 label / icon 是否经过 placement 与 collision 后仍可见

---

## MapLibre 可移植内容

### 已借鉴或移植

- [x] style 解析与表达式求值（部分）
- [x] layer family 分组
- [x] feature filter（基础）
- [x] worker tile parse 的阶段划分
- [x] bucket populate 的组织方式

### 适合直接借鉴或移植

- [ ] glyph / sprite atlas 管理思想
- [ ] symbol layout
- [ ] collision index
- [ ] cross-tile symbol index
- [ ] feature index / query rendered features 思路

### 只适合借鉴思路，不应直接照搬

- 以 WebMercator 平面 map transform 为中心的相机模型
- 以 painter 为核心的 GL 状态组织
- 以 map zoom/bearing/pitch 为绝对主坐标系的运行时
- 直接依赖 `maplibre-gl-js/src/...` 私有模块的运行方式

### 必须按 Cesium 重写

- [x] globe 上的 tile 选择和可见性评估
- [x] cartographic / cartesian 坐标转换
- [ ] 与 ellipsoid、terrain、3d tiles 的深度关系
- [x] Cesium primitive / drawcommand 的命令组织
- [x] requestRender 模式下的刷新触发
- [x] GPU 资源生命周期
- [ ] picking 与 featureId 映射
- [x] 内存预算与 cache trim 触发

---

## 额外功能

- [ ] **feature-state 支持**
- [ ] **style 热更新与 diff**
- [x] **GeoJSON source 统一接入**（已实现 GeojsonSourceCache）
- [ ] **多 source 统一调度**
- [ ] **glyph / sprite / pattern 统一资源预算**
- [ ] **debug 可视化**
- [ ] **性能指标面板**
- [ ] **overzoom / underzoom 策略**
- [ ] **wrap / antimeridian 稳定性**

---

## 禁止事项

- ❌ 不建议先把 MVT 全部 rasterize 到 canvas，再贴回 imagery
- ❌ 不建议长期直接 import MapLibre 私有源码路径作为生产依赖
- ❌ 不建议为了兼容试验过程而保留两套 style evaluator
- ❌ 不建议把 symbol 也强行塞进 BufferCollection
- ❌ 不建议一上来就做跨 tile 全局 mega batch
- ❌ 不建议在没有 debug 指标的情况下盲做缓存优化
- ❌ 禁止 module-level 全局缓存
- ❌ 禁止 worker 输出再 clone 一份大对象到主线程
- ❌ 禁止 atlas 无上限增长
- ❌ 禁止 style 切换后旧 epoch 数据继续写回当前 provider

---

## Buffer\*Collection 限制

当前使用 `BufferPolygonCollection`、`BufferPolylineCollection`、`BufferPointCollection` 作为渲染后端，这些是 Cesium 1.140 新增的实验性 API，存在以下限制：

### 已知限制

| 限制                      | 说明                                 | 影响                                    |
| ------------------------- | ------------------------------------ | --------------------------------------- |
| 不支持贴地                | 无法自动贴合地形，几何体使用固定高度 | 有地形时几何体可能悬浮或穿地            |
| 不支持背面剔除控制        | 默认启用背面剔除，无法禁用           | 视角接近平视地面时，面可能消失          |
| 不支持 classificationType | 无法指定贴附目标（地形/3D Tiles）    | 无法实现分类渲染                        |
| Material API 有限         | 仅支持简单的颜色、线宽等属性         | 复杂样式（dash、pattern）需要自定义实现 |

### 当前应对策略

| 问题       | 应对方案                                                         |
| ---------- | ---------------------------------------------------------------- |
| Z-fighting | 点、线、面使用不同高度偏移（面=0m，线=1m，点=2m）                |
| 视角丢失   | 暂时接受限制，后续评估是否切换到 GroundPrimitive                 |
| 地形适配   | 暂不支持，待评估 GroundPrimitive 或 ClassificationPrimitive 方案 |

### 未来可选方案

如需解决上述限制，可考虑：

1. **GroundPrimitive**：支持贴地，但需要放弃高性能批处理
2. **ClassificationPrimitive**：支持分类渲染，适用于"染色"场景
3. **等待 Cesium 官方支持**：Buffer\*Collection 是实验性 API，未来可能增加贴地能力

---

## 风险与决策

| 风险                              | 问题                                            | 决策                                           |
| --------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| 把 ImageryProvider 当成最终承载层 | 会持续受 raster 语义约束                        | 只把它当 facade，不把核心渲染逻辑塞进去        |
| 直接依赖 MapLibre 私有运行时      | 升级脆弱，browser map 假设太重                  | 选择性移植关键模块，形成受控的 `maplibre-port` |
| 过早追求完整 style 覆盖           | symbol、dash、pattern、extrusion 同时推进会失控 | 先做基础几何，后做 symbol，再做复杂样式        |
| 忽视 globe 差异                   | 很多"平面地图上成立"的假设在 globe 上会失真     | 明确增加 Cesium 视图适配层，明确几何细分策略   |
| 没有指标就做优化                  | 最终很可能得到一堆经验补丁                      | debug overlay 与性能指标和首批渲染功能同步建设 |

---

## 测试与验证

### 单元测试

- [x] **style loader**
  - 相对路径解析
  - source / sprite / glyph URL 解析
- [x] **tile key / cache**
  - canonical key
  - overscaled key
  - LRU trim
  - touch 逻辑
- [x] **geometry**
  - polygon triangulation
  - line subdivision
  - tile border 一致性
- [x] **style evaluation**
  - layer visibility
  - layer family
- [ ] **symbol**
  - collision 结果稳定性
  - cross-tile id 延续
  - placement 节流

### 集成测试

- [x] camera 平移缩放
- [ ] style 热切换
- [x] destroy 后资源释放

### 手工验证

- [ ] 连续平移 5 分钟看内存是否稳定
- [ ] 高频缩放看 label 是否闪烁
- [ ] terrain 开关下看 z-fighting 与遮挡行为
- [ ] 切换 style 看是否发生全量闪断
- [ ] 打开 debug overlay 看 cache hit/miss 是否符合预期

---

## 首版 public API

```ts
const provider = new StyleImageryProvider({
  scene: viewer.scene,
  style: 'https://tiles.openfreemap.org/styles/bright',
  minimumLevel: 0,
  maximumLevel: 16,
});

viewer.imageryLayers.addImageryProvider(provider);
```

或使用静态方法：

```ts
const provider = await StyleImageryProvider.fromUrl(
  'https://tiles.openfreemap.org/styles/bright',
  { scene: viewer.scene }
);
```

后续 API：

- `updateStyle(style)` - ❌ 未实现
- `setFeatureState(...)` - ❌ 未实现
- `queryRenderedFeatures(...)` - ❌ 未实现
- `trimCache()` - ❌ 未实现
- `destroy()` - ✅ 已实现

---

## 工程约束

- worker 输出只传纯数据，不传 Cesium 对象 ✅
- backend 只消费统一的 render bucket，不直接依赖原始 PBF ✅
- 所有图层顺序都要可追踪 ✅
- cache 与 atlas 都必须有 byte 级预算 ✅
- provider / scene layer / cache / backend 的销毁路径必须完整 ✅
- 新增功能必须自带 debug 开关与指标 ❌

---

## 最终收敛形态

- **对外**：一个能接收 style url 的 Cesium 图层能力
- **对内**：一套以 Cesium scene、primitive、drawcommand、request scheduler、cache 语义为中心的矢量渲染系统
- **借鉴**：MapLibre 在 style/bucket/placement/query 上的成熟经验
- **发挥**：Cesium 在 globe、terrain、3D、海量 primitive、生命周期控制上的优势

后续扩展方向：

- GeoJSON source ✅ 已实现
- fill-extrusion / 3D building
- terrain-aware labels
- 与 3D Tiles 的协同表达
