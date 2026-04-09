# Cesium MVT 向量渲染实现任务清单

## 核心目标

借鉴 MapLibre 在样式解析、tile 生命周期、bucket 化、symbol 布局、碰撞检测、跨 tile 稳定性、缓存与增量更新上的成熟经验，最终收敛出一套以 Cesium 为主导的数据模型和渲染架构。

**核心原则**：

- 以 Cesium 为中心，不把 Cesium 变成"套壳 MapLibre"
- 外部 API 可以长得像 `ImageryProvider`，内部必须以 Cesium 为主
- 不保留双轨实现，实验结束后收敛到单一实现
- 复用 MapLibre 的方法论、数据阶段和局部模块，不直接依赖整套运行时

---

## 阶段 0：定边界与脚手架

### TODO 列表

- [x] **创建项目目录结构**

  ```
  src/mvt/
    imagery-provider.ts
    scene-layer.ts
    view-state.ts
    style/
    source/
    render/
    atlas/
    query/
    geometry/
    worker/
    debug/
    utils/
    maplibre-port/
  ```

- [x] **实现 StyleImageryProvider 基础框架**
  - 接受 style url 或 style json
  - 实现 `requestImage` 返回透明占位图像
  - 维护 `solid-image-cache` 按背景色复用 1x1 图片
  - 对外暴露 `ImageryProvider` 语义

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

- [x] **验收标准**
  - viewer 中可成功加载 style
  - scene layer 正常初始化与销毁
  - requestRender 模式下不会卡死

---

## 阶段 1：基础几何渲染

### TODO 列表

- [x] **实现 worker tile parse**
  - PBF 解码成 feature
  - 按 style layer family 构建 bucket 中间结果
  - 输出 bucket stats 和 typed arrays
  - 输出不要带 WebGL 对象

- [x] **实现 fill/line/circle bucket builder**
  - fill bucket builder
  - line bucket builder
  - circle bucket builder

- [x] **实现 globe 投影与几何细分**
  - 所有 line 与 fill 边界在投影到 globe 前做自适应细分
  - 细分条件基于 chord error、角度变化或 screen-space error
  - 同一 tile 边界与相邻 tile 使用一致规则，避免裂缝

- [x] **实现 Buffer 后端**
  - `BufferPolygonCollection` 承接 fill
  - `BufferPolylineCollection` 承接基础 line
  - `BufferPointCollection` 承接 circle
  - worker 先做统计，主线程一次性按精确容量分配 collection

- [x] **实现 tile buffer 与裁剪策略**
  - parse 保留 buffer 区域几何
  - render 视需要在 tile bounds 内裁剪

- [ ] **实现 background 处理**
  - scene 背景色或专用全屏 pass
  - 不应走 tile 几何

- [x] **验收标准**
  - 能正确渲染开源 bright style 中的基础地物
  - tile 切换无明显闪烁
  - cache 可工作

---

## 阶段 2：缓存、查询、增量更新

### TODO 列表

- [ ] **实现 tile cache 系统**
  - `source-tile-cache`
  - `parsed-tile-cache`
  - `render-tile-cache`
  - 所有 cache entry 都能估算 `byteLength`

- [ ] **实现 LRU 与 trim 机制**
  - 每帧开始先把缓存分成"本帧未触达"和"本帧已触达"
  - 选中的 tile 调用 `touch`
  - frame 结束后按内存预算 trim
  - trim 时优先淘汰最久未使用且不阻塞当前显示的 tile

- [ ] **实现 request scheduler**
  - tile、sprite、glyph、tilejson 请求全部进统一调度
  - 优先级按"当前视图是否阻塞渲染"排序
  - 远离视图的请求要及时取消

- [ ] **实现请求取消机制**
  - 取消本帧未 `touch` 的 in-flight tile 请求
  - 对相机快速移动场景，引入节流策略

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

- [ ] **验收标准**
  - 反复平移缩放内存不持续上涨
  - tile 离开视图后可按预算回收
  - paint 变更不触发全量重建

---

## 阶段 3：symbol 系统

### TODO 列表

- [ ] **实现 glyph manager**
  - glyph / sprite atlas 独立管理
  - 支持引用计数与 trim

- [ ] **实现 sprite manager**
  - sprite atlas 管理
  - 支持引用计数与 trim

- [ ] **实现 symbol draw command backend**
  - symbol quad 的几何与 opacity buffer 分离
  - 自定义 `DrawCommand`
  - 进入 `Pass.TRANSLUCENT`

- [ ] **实现 transform-adapter**
  - 输出供样式与 placement 使用的统一视图状态
  - canvas 宽高、中心点 cartographic、参考 zoom、meters-per-pixel
  - 近似 bearing、pitch、cameraToCenterDistance 等效量

- [ ] **实现 placement 系统**
  - collision index
  - cross-tile symbol index
  - placement 只在视图变化超过阈值时重算
  - camera 轻微变化时优先重用上帧 placement 状态

- [ ] **实现 symbol visibility 分析**
  - 该 tile 内的 label / icon 是否经过 placement 与 collision 后仍可见
  - 决定最终 symbol command

- [ ] **验收标准**
  - 点标注可稳定显示
  - 缩放与平移时无明显 label 闪烁
  - 碰撞结果基本符合 style 预期

---

## 阶段 4：复杂样式与 Cesium 强化

### TODO 列表

- [ ] **实现自定义 pattern backend**
  - 支持 fill-pattern
  - 需要纹理与 UV

- [ ] **实现自定义 line shader/backend**
  - 支持 line-dasharray
  - `BufferPolylineCollection` 不足以保真

- [ ] **评估 line symbol**
  - line-placement 对 globe 和透视投影的适配

- [ ] **接 terrain**
  - terrain-aware placement
  - 支持 elevation 接口

- [ ] **评估 fill-extrusion**
  - 专用 primitive / draw command
  - 可结合 Cesium 3D 能力扩展

- [ ] **验收标准**
  - 能覆盖主流矢量底图 style 的大部分图层
  - 复杂样式下 draw call 与内存仍可控

---

## 核心状态机设计

### Tile 状态定义

必须显式区分四个概念：

- `candidate`：进入当前帧遍历范围的 tile
- `selected`：当前帧经过可见性分析后，理论上希望用于渲染的 tile
- `shown`：当前帧真正向 Cesium 提交了 command / collection 的 tile
- `touched`：当前帧被使用过、保活过或仍被依赖的 tile

生命周期位：

- `hidden`：当前帧不再 `shown`，但内容仍保留在 cache 中
- `eligible-for-unloading`：当前帧未 `touched` 且无外部占用，才允许真正释放

### Fallback 机制

当目标层级的瓦片不可用时，需要使用祖先瓦片作为 fallback：

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
  - 再做 symbol placement / collision

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

- [ ] **source tile**：原始请求单元，存放 PBF、TileJSON 元数据
- [ ] **parsed tile**：worker 输出，包含 feature index、bucket stats
- [ ] **render tile**：主线程可渲染单元，持有 Cesium backend 资源句柄
- [ ] **placement state**：与当前视图相关，包含 collision、cross-tile ids

---

## 缓存管理

### 缓存机制的重要性

**当前缺失的关键功能**：缓存机制尚未实现，这导致以下问题：

1. **瓦片过早卸载**：瓦片在移出视口后，如果没有被 `touched`，就会被立即卸载
2. **Fallback 失效**：当所有层级的瓦片都加载失败或返回空数据时，没有 fallback 可用
3. **内存压力**：没有基于内存预算的动态调整机制

### MapLibre 的缓存策略（参考）

MapLibre 使用 LRU（最近最少使用）缓存策略：

- **动态缓存容量**：根据视口大小动态计算缓存容量
- **父子瓦片关联**：通过 `findLoadedParent()` 在缓存中查找已加载的父级瓦片
- **保留机制**：`_updateRetainedTiles` 保留父子瓦片，确保 fallback 可用

### Provider 作为缓存根对象

所有缓存都应该以 `StyleImageryProvider` 实例为根对象持有：

- [ ] `solid-image-cache`
- [ ] `source-tile-cache`
- [ ] `parsed-tile-cache`
- [ ] `render-tile-cache`
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

## 内存预算

从第一版开始就有明确预算：

- [ ] `sourceTileCacheBytes`
- [ ] `parsedTileCacheBytes`
- [ ] `renderTileCacheBytes`
- [ ] `glyphAtlasCacheBytes`
- [ ] `spriteAtlasCacheBytes`
- [ ] `maximumCacheOverflowBytes`

---

## 渲染后端分工

| 图层类型           | 推荐后端                      | 阶段     |
| ------------------ | ----------------------------- | -------- |
| `background`       | scene 背景色或专用全屏 pass   | 第一阶段 |
| `fill`             | `BufferPolygonCollection`     | 第一阶段 |
| `line` 基础实线    | `BufferPolylineCollection`    | 第一阶段 |
| `circle`           | `BufferPointCollection`       | 第一阶段 |
| `symbol` 文本/图标 | 自定义 `DrawCommand`          | 第二阶段 |
| `line-dasharray`   | 自定义 `DrawCommand`          | 第二阶段 |
| `fill-pattern`     | 自定义 `DrawCommand`          | 第二阶段 |
| `fill-extrusion`   | 专用 primitive / draw command | 第三阶段 |

---

## 可见性分析分层

- [ ] **tile visibility**：tile bounds 是否与当前视锥、地平线遮挡、source rectangle 相交
- [ ] **render visibility**：该 tile 在当前层级决策下，是否应由自己显示
- [ ] **symbol visibility**：该 tile 内的 label / icon 是否经过 placement 与 collision 后仍可见

---

## MapLibre 可移植内容

### 适合直接借鉴或移植

- [ ] style 解析与表达式求值
- [ ] layer family 分组
- [ ] feature filter
- [ ] worker tile parse 的阶段划分
- [ ] bucket populate 的组织方式
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

- [ ] globe 上的 tile 选择和可见性评估
- [ ] cartographic / cartesian 坐标转换
- [ ] 与 ellipsoid、terrain、3d tiles 的深度关系
- [ ] Cesium primitive / drawcommand 的命令组织
- [ ] requestRender 模式下的刷新触发
- [ ] GPU 资源生命周期
- [ ] picking 与 featureId 映射
- [ ] 内存预算与 cache trim 触发

---

## 额外功能

- [ ] **feature-state 支持**
- [ ] **style 热更新与 diff**
- [ ] **GeoJSON source 统一接入**
- [ ] **多 source 统一调度**
- [ ] **glyph / sprite / pattern 统一资源预算**
- [ ] **debug 可视化**
  - tile 边框、tile id
  - collision boxes、symbol anchors
  - cache hit / miss
  - atlas 占用
  - draw command 数量
- [ ] **性能指标面板**
  - parse time、upload time、placement time
  - rendered tiles、pending requests
  - cache bytes、atlas bytes
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

- [ ] **style loader**
  - 相对路径解析
  - source / sprite / glyph URL 解析
- [ ] **tile key / cache**
  - canonical key
  - overscaled key
  - LRU trim
  - touch 逻辑
- [ ] **geometry**
  - polygon triangulation
  - line subdivision
  - tile border 一致性
- [ ] **style evaluation**
  - paint diff
  - layout diff
  - filter 命中
- [ ] **symbol**
  - collision 结果稳定性
  - cross-tile id 延续
  - placement 节流

### 集成测试

- [ ] camera 平移缩放
- [ ] style 热切换
- [ ] destroy 后资源释放

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
  source: 'openmaptiles',
  minimumLevel: 0,
  maximumLevel: 16,
  cacheBytes: 256 * 1024 * 1024,
  crossSourceCollisions: true,
  enablePicking: true,
  debug: false,
});

viewer.imageryLayers.addImageryProvider(provider);
```

后续 API：

- `updateStyle(style)`
- `setFeatureState(...)`
- `queryRenderedFeatures(...)`
- `trimCache()`
- `destroy()`

---

## 工程约束

- worker 输出只传纯数据，不传 Cesium 对象
- backend 只消费统一的 render bucket，不直接依赖原始 PBF
- 所有图层顺序都要可追踪
- cache 与 atlas 都必须有 byte 级预算
- provider / scene layer / cache / backend 的销毁路径必须完整
- 新增功能必须自带 debug 开关与指标

---

## 最终收敛形态

- **对外**：一个能接收 style url 的 Cesium 图层能力
- **对内**：一套以 Cesium scene、primitive、drawcommand、request scheduler、cache 语义为中心的矢量渲染系统
- **借鉴**：MapLibre 在 style/bucket/placement/query 上的成熟经验
- **发挥**：Cesium 在 globe、terrain、3D、海量 primitive、生命周期控制上的优势

后续扩展方向：

- GeoJSON source
- fill-extrusion / 3D building
- terrain-aware labels
- 与 3D Tiles 的协同表达
