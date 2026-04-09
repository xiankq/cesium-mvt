# Cesium MVT 向量渲染实现设想

## 目标定位

目标不是把 MapLibre 原封不动搬进 Cesium，而是借鉴 MapLibre 在样式解析、tile 生命周期、bucket 化、symbol 布局、碰撞检测、跨 tile 稳定性、缓存与增量更新上的成熟经验，最终收敛出一套以 Cesium 为主导的数据模型和渲染架构。

建议把这件事定义成下面这句话：

`StyleImageryProvider` 负责接受 style url、参与 Cesium 的入口语义与 tile 生命周期接入；真正的矢量渲染、缓存、symbol placement、GPU 资源管理，统一收敛到 Cesium 风格的 scene primitive / drawcommand 管线。

这意味着：

- 可以深度借鉴 MapLibre 的流程，但不能把 Cesium 变成一个“套壳 MapLibre”。
- 外部 API 可以长得像 `ImageryProvider`，内部状态机、缓存语义、渲染命令组织必须以 Cesium 为主。
- 不保留“MapLibre 原样 runtime”和“Cesium 改写 runtime”双轨实现，实验结束后要收敛到单一实现。
- 复用 MapLibre 时优先复用方法论、数据阶段和局部模块，不直接依赖它的整套地图运行时假设。

## 核心判断

- `ImageryProvider` 适合做入口层，不适合做最终渲染层。它天然面向 raster texture，而不是面向 vector draw command。
- Cesium 1.140.0 的 `BufferPointCollection`、`BufferPolylineCollection`、`BufferPolygonCollection` 很适合承接 `circle`、基础 `line`、基础 `fill` 这类高吞吐矢量几何。
- `symbol`、SDF glyph、sprite icon、line dash、pattern fill、复杂混合与精确 MapLibre 样式保真，大概率仍然需要自定义 `DrawCommand`。
- MapLibre 最值得借鉴的不是它的 WebGL 细节本身，而是它对 style -> layer family -> bucket -> placement -> query -> cache 这一整条阶段链的组织方式。
- Cesium 最值得复用的是它的 request 调度、tile cache/LRU、frame update 节奏、primitive 生命周期、picking 语义、GPU 资源释放时机。
- Globe 场景不是 WebMercator 平面。所有“单一 zoom / bearing / pitch”式的 MapLibre 假设，都必须经过 Cesium 适配层重解释。

## 总体架构

推荐采用“双层架构”：

### 1. 外部接入层

职责：

- 接受 `style` url 或 style json。
- 解析 source、sprite、glyph、tilejson。
- 对外暴露 `ImageryProvider` 语义。
- 与 `viewer.imageryLayers.addImageryProvider(...)` 的现有接入方式兼容。
- 实现 `pickFeatures` 兼容入口。

建议对象：

- `imagery-provider.ts`
- `style/style-loader.ts`
- `style/style-set.ts`

这一层不负责真正画图，只负责：

- 初始化内部 `scene-layer`
- 向内部渲染层同步 tile hint 与入口事件
- 在必要时返回共享的透明占位图像，维持 Cesium imagery 生命周期

### 2. 内部渲染层

职责：

- 维护 source cache、tile cache、worker parse、bucket 数据、atlas、placement 状态。
- 在 `scene.preRender` 或等价更新点推进状态机。
- 将渲染结果组织为 Cesium `Primitive` / `DrawCommand`。
- 对接 Cesium 的 request render、资源销毁、pick、debugShowBoundingVolume 等机制。

建议对象：

- `scene-layer.ts`
- `source/tile-manager.ts`
- `source/source-cache.ts`
- `render/render-tile.ts`
- `render/backend/*.ts`
- `render/placement/placement.ts`

## 为什么入口层继续使用 ImageryProvider

这样做有三个现实好处：

- 现有接入方式最短，用户心智简单，可以直接通过 style url 初始化。
- 可借用 Cesium 现有 imagery 接入语义，快速形成实验路径。
- 可保留 `pickFeatures`、credit、tilingScheme、rectangle、minimumLevel、maximumLevel 这些入口语义。

但它也有明显局限：

- `requestImage` 的本体语义是“给 tile 返回图像”，不是“驱动独立矢量渲染层”。
- ImageryLayer 会为每个 tile 管理 texture 生命周期，哪怕你返回的是透明占位图，也仍然有额外开销。
- tile 回收、优先级与缓存触发点更偏 raster 语义，长期会限制矢量系统的控制力。

因此建议采用分阶段策略：

- 第一阶段：保留 `ImageryProvider` facade，允许 `requestImage` 返回共享背景小图，但 tile 的 selected / fallback / hide / unload 仍由内部 `tile-manager` 驱动。
- 第二阶段：在 scene renderer 稳定后，把 tile 选择与缓存收敛到自有 `tile-manager`，`ImageryProvider` 只保留入口语义。
- 最终形态：外部还是 `StyleImageryProvider.fromStyle(...)`，但核心行为已经是 Cesium 风格的独立矢量图层。

### requestImage 的保留价值与具体策略

`requestImage` 仍然有明确用处，但它的职责应该被收窄：

- 它负责维持 Cesium imagery 生命周期入口，不负责真正的矢量绘制。
- 它可以返回一个由 style 解析得到的 `background-color` 纯色 1x1 小图片。
- 当 style 中没有背景色，或者背景透明时，它可以返回共享的透明 1x1 小图片。

推荐策略：

- 在 `StyleImageryProvider` 实例上维护 `solid-image-cache`，按 `rgba` 或 `style-epoch + rgba` 作为 key。
- 缓存值应是复用的单个图片对象或其 promise，例如共享 `HTMLCanvasElement`、`ImageBitmap` 或 `Promise<ImageBitmap>`。
- 所有 tile 的 `requestImage` 命中同一种背景色时，返回同一个缓存对象，避免重复创建 1x1 图片。

但要明确它的边界：

- 复用 1x1 图片对象只能减少 JS 侧对象创建和颜色填充开销。
- Cesium 的 `ImageryLayer` 在收到 `image` 后，仍会为每个 imagery tile 单独创建 texture，所以这不是核心 GPU 优化点。
- `tileWidth` / `tileHeight` 仍应维持逻辑上的 imagery 分辨率语义，不能因为返回 1x1 图片就把 provider 的 tile 尺寸也改成 1，否则会影响 Cesium 的 texel spacing 与层级选择。

因此，`requestImage` 的正确定位是：

- 保留入口价值
- 复用背景图像对象
- 不把它当成主要缓存优化抓手
- 真正的缓存/性能/内存优化重点仍放在矢量 tile、bucket、atlas 和 draw command 上

### requestImage 不是可见性分析入口

这一点需要单独强调：`requestImage` 不能被粗暴当成“这个 tile 现在应该渲染”或“这个 tile 现在应该卸载”的依据。

原因有几类：

- imagery 的请求语义是“这个 raster tile 当前可能需要一张图”，不是“这个 vector tile 本帧最终会进入命令列表”。
- 某个 tile 可能已经被请求，但由于父级 fallback、子级 refine、深度遮挡、预算限制，最终本帧并不会显示。
- 某个 tile 可能本帧不显示，但仍必须保留在内存里，作为下一帧 refine、symbol cross-tile 稳定性、query 或 atlas 依赖的热数据。
- 某些 tile 即使当前不在严格可见集里，也可能因为 `preloadAncestors`、`preloadSiblings`、相机运动预测而被提前请求。
- symbol 的最终可见性还要经过 screen-space placement 与 collision，这一步天然晚于 `requestImage`。

因此推荐的边界是：

- `requestImage` 只负责 provider facade 与背景色小图返回。
- imagery tile key 可以作为实验阶段的“辅助 hint”，但不能作为最终 selected set。
- 真正的可见性分析必须在 `scene-layer` / `tile-manager` 里，基于当前帧 `frameState` 自主完成。
- 隐藏、保留、卸载、取消请求这些动作，都不能直接绑定到 `requestImage` 的调用与否。

## “借鉴 MapLibre，但以 Cesium 为主”的具体落点

### 适合直接借鉴或移植的部分

- style 解析与表达式求值
- layer family 分组
- feature filter
- worker tile parse 的阶段划分
- bucket populate 的组织方式
- glyph / sprite atlas 管理思想
- symbol layout
- collision index
- cross-tile symbol index
- feature index / query rendered features 思路

### 只适合借鉴思路，不应直接照搬的部分

- 以 WebMercator 平面 map transform 为中心的相机模型
- 以 painter 为核心的 GL 状态组织
- 以 map zoom/bearing/pitch 为绝对主坐标系的运行时
- 直接依赖 `maplibre-gl-js/src/...` 私有模块的运行方式
- Web map 默认的 draw order、深度策略、地形关系

### 必须按 Cesium 重写的部分

- globe 上的 tile 选择和可见性评估
- cartographic / cartesian 坐标转换
- 与 ellipsoid、terrain、3d tiles 的深度关系
- Cesium primitive / drawcommand 的命令组织
- requestRender 模式下的刷新触发
- GPU 资源生命周期
- picking 与 featureId 映射
- 内存预算与 cache trim 触发

## 命名原则

文件、类、函数名不建议持续带 `mvt` 前缀。因为在 `src/mvt/` 这个目录边界里，上下文已经足够明确，再在每个对象名里重复一次会让命名又长又重。

推荐规则：

- 顶层目录表达领域边界
- 文件名表达职责
- 类名表达角色
- 函数名表达动作

推荐示例：

- `src/mvt/imagery-provider.ts`
  - `StyleImageryProvider`
- `src/mvt/scene-layer.ts`
  - `SceneLayer`
- `src/mvt/source/tile-manager.ts`
  - `TileManager`
- `src/mvt/source/source-cache.ts`
  - `SourceCache`
- `src/mvt/style/style-loader.ts`
  - `StyleLoader`
- `src/mvt/render/render-tile.ts`
  - `RenderTile`
- `src/mvt/render/placement/collision-index.ts`
  - `CollisionIndex`

尽量避免：

- `MvtImageryProvider`
- `MvtSceneLayer`
- `MvtTileManager`
- `MvtRenderTile`
- `createMvtRenderTileFromMvtBucket`

更推荐：

- `StyleImageryProvider`
- `SceneLayer`
- `TileManager`
- `RenderTile`
- `createRenderTileFromBucket`

也就是说：

- 领域前缀只保留在目录层
- 对象名尽量短
- 只有跨领域冲突明显时，才补一个必要限定词，比如 `StyleImageryProvider`、`GlyphManager`、`RenderTile`

## 建议的模块拆分

建议目录：

```text
src/mvt/
  imagery-provider.ts
  scene-layer.ts
  view-state.ts
  style/
    style-loader.ts
    style-set.ts
    layer-index.ts
    layer-family.ts
    style-diff.ts
  source/
    source-cache.ts
    tile-manager.ts
    tile-request.ts
    tile-cache.ts
    feature-state-store.ts
  render/
    render-tile.ts
    render-queue.ts
    render-order.ts
    backend/
      fill-backend.ts
      line-backend.ts
      circle-backend.ts
      symbol-backend.ts
      pattern-backend.ts
    placement/
      transform-adapter.ts
      placement.ts
      collision-index.ts
      cross-tile-symbol-index.ts
  atlas/
    glyph-manager.ts
    sprite-manager.ts
    pattern-manager.ts
  query/
    query-service.ts
    pick-service.ts
  geometry/
    globe-projection.ts
    line-subdivider.ts
    polygon-builder.ts
    polyline-builder.ts
    circle-builder.ts
  worker/
    entry.ts
    protocol.ts
    tile-parse.ts
    bucket-build.ts
  debug/
    debug-state.ts
    debug-overlay.ts
    stats-panel.ts
  utils/
    color-cache.ts
    key-utils.ts
    memory-budget.ts
    disposable.ts
  maplibre-port/
    style-layer-index.ts
    feature-index.ts
    symbol-layout.ts
    placement-core.ts
```

重点原则：

- 不要把所有逻辑塞进 `imagery-provider.ts`。
- `maplibre-port` 只放“被确认需要移植、且已经 Cesium 化边界”的模块。
- 不建议在生产方案里长期深度 import `node_modules/maplibre-gl-js/src/...` 私有路径。
- `render`、`style`、`source`、`atlas`、`query`、`debug`、`utils` 这些目录应尽早建立，避免后期继续长成平铺结构。

## 数据流与生命周期

推荐主流程：

1. `StyleImageryProvider` 接受 `style` url。
2. `style/style-loader` 拉取 style json，解析相对路径，补齐 source/sprite/glyph 资源定位。
3. `scene-layer` 初始化到 `scene.primitives`，并与 provider 建立引用关系。
4. `source/tile-manager` 根据当前视图生成目标 tile 集合，并独立完成可见性分析。
5. `source/source-cache` 负责 raw tile 请求、去重、取消、重试与状态缓存。
6. worker 将 PBF 解码成 feature，并按 style layer family 构建 bucket 中间结果。
7. 主线程把 bucket 结果交给不同 backend，生成 `Buffer*Collection` 或 `DrawCommand`。
8. 每帧在 `preRender` 中推进可见性分析、selection、placement、request、upload。
9. 每帧在 `postRender` 中推进 touch 标记归档、请求取消、trim、destroy。
10. 在 `requestRenderMode: true` 下，任何异步 tile ready、atlas ready、placement changed、style changed 都要调用 `scene.requestRender()`。
11. layer 销毁时释放 worker、cache、atlas、primitive、draw command、事件监听。

## 按需渲染、隐藏与卸载的推荐状态机

这里建议显式区分四个概念，不要混成一个“visible”：

- `candidate`
  - 进入当前帧遍历范围的 tile
  - 只是说明“需要评估”，不代表会被请求或显示

- `selected`
  - 当前帧经过可见性分析与层级决策后，理论上希望用于渲染的 tile
  - 可能是最终 tile，也可能是 fallback tile

- `shown`
  - 当前帧真正向 Cesium 提交了 command / collection 的 tile
  - 这是最接近“实际在屏幕上参与渲染”的状态

- `touched`
  - 当前帧被使用过、保活过或仍被依赖的 tile
  - 它不仅包含 `shown`，还可以包含 fallback、预加载依赖、正在 refine 链上的关键父子节点

再补两个生命周期位：

- `hidden`
  - 当前帧不再 `shown`
  - 但内容仍然保留在 cache 中，等待下次快速复用

- `eligible-for-unloading`
  - 当前帧未 `touched`
  - 且没有请求、worker、upload、placement、pick 等外部占用
  - 只有这类 tile 才允许真正释放重资源

### 推荐的帧内流程

这一套流程更接近 `QuadtreeTileProvider` 的 `beginUpdate -> computeTileVisibility -> showTileThisFrame -> endUpdate`，再结合 `3D Tiles` 的 `touch -> request -> trim` 思路，但最终状态机仍以本项目自己的矢量语义为准。

1. `begin-frame`
   - 读取 `frameState`
   - 生成 `view-state`
   - 重置所有 tile 的本帧标记：`isCandidate`、`isSelected`、`isShown`、`isTouched`

2. `collect-candidates`
   - 从 root tile、上帧热 tile、in-flight tile、fallback tile 出发生成候选集
   - 不要求这一步严格等于 imagery 当前请求集

3. `compute-visibility`
   - 基于 frustum、horizon/occluder、source rectangle、level 范围、近似屏幕误差、相机距离计算 tile 是否进入可见遍历
   - 这一层只回答“需不需要继续看它或它的子节点”，不直接决定 render order

4. `select-tiles`
   - 结合 target level、refine 条件、父子 readiness、fallback 策略，确定当前帧 selected set
   - 与 `3D Tiles` 类似，允许“理想子级未 ready 时继续显示父级”

5. `request-and-promote`
   - 对 selected 但未 ready 的 tile 发起请求
   - 对正在 refine 链上的关键祖先与必要 sibling 做低优先级预取
   - 对已经 ready 的 tile 进入 render candidate

6. `placement-and-show`
   - 先做几何层的 show set
   - 再做 symbol placement / collision，得到最终 symbol show set
   - 只有通过这一步的 tile，才进入本帧 command / collection 提交

7. `hide-unused`
   - 上帧 `shown` 但本帧未进入 show set 的 tile，不立即 destroy
   - 先转成 `hidden`
   - 对应 collection 不再提交命令，或把该 tile 的 render handle 标记为 inactive

8. `touch-retained`
   - 当前帧 `shown` 的 tile 必须 `touch`
   - 当前帧作为 fallback 使用的 tile 必须 `touch`
   - 当前帧虽然未显示、但仍阻塞 refine、placement、atlas 依赖或 query 的 tile，也应按规则 `touch`

9. `post-frame-trim`
   - 统一取消本帧未 `touch` 的 in-flight 请求
   - 统一检查 cache budget
   - 只对“未 `touch` 且 `eligible-for-unloading`”的 tile 执行真实 unload

### 隐藏不等于卸载

这是缓存与流畅性的关键边界。

- 隐藏的目标是避免错误显示
- 卸载的目标是回收 CPU / GPU 内存

推荐策略：

- tile 退出当前 show set 时，默认先隐藏，不立刻卸载
- 只有在预算压力或长期未触达时，再把隐藏 tile 推进到 unload
- unload 优先释放 render content，再决定是否回收 parsed/raw content

这和 3D Tiles 很像，但不能完全照搬，因为：

- MVT tile 还要承担 symbol placement、cross-tile id、atlas 引用这些额外依赖
- 一个 tile 的几何不可见，不代表它的 symbol 辅助状态就已经完全无用
- map style 的图层顺序与 symbol 可见性比普通 content tile 更依赖 screen-space 结果

### 可见性分析建议

建议把可见性分成三层，而不是只做一个“在不在视锥里”的判断：

1. `tile visibility`
   - tile bounds 是否与当前视锥、地平线遮挡、source rectangle 相交
   - 决定是否继续遍历

2. `render visibility`
   - 该 tile 在当前层级决策下，是否应由自己显示、还是由父级 / 子级承担显示
   - 决定 `selected` 与 fallback

3. `symbol visibility`
   - 该 tile 内的 label / icon 是否经过 placement 与 collision 后仍可见
   - 决定最终 symbol command

这三层里，`requestImage` 最多只能沾到第一层的一部分入口语义，不能覆盖第二层和第三层。

### 推荐的内部接口

为了让职责清晰，建议从一开始就把流程落成显式接口，而不是散在各处条件分支里：

```ts
sceneLayer.preRender(frameState);
tileManager.beginFrame(viewState);
tileManager.collectCandidates();
tileManager.computeVisibility();
tileManager.selectTiles();
tileManager.requestTiles();
sceneLayer.updatePlacement(viewState);
sceneLayer.submitCommands(frameState);
tileManager.endFrame();
sceneLayer.postRender(frameState);
```

这样后面不论是继续靠 `ImageryProvider` facade，还是逐步收敛成更独立的 quadtree 驱动，都不会把可见性、显示、请求、卸载搅成一团。

## 关键状态分层

建议把 tile 状态分成四层，不要混在一个对象里：

- `source tile`
  - 原始请求单元
  - 键一般是 `source-id + canonical z/x/y`
  - 存放 PBF、TileJSON 元数据、etag、过期信息

- `parsed tile`
  - worker 输出
  - 包含 feature index、bucket stats、布局中间数据、symbol 实例、glyph/icon 依赖

- `render tile`
  - 主线程可渲染单元
  - 键一般是 `source-id + overscaled z/x/y/wrap + style-epoch`
  - 持有 Cesium backend 资源句柄

- `placement state`
  - 与当前视图相关
  - 包含 collision、cross-tile ids、opacity/fade、可见 symbol 集

这个拆分很重要，因为：

- 原始 tile 可被多个 overscaled render tile 复用。
- paint 改变不一定要重走 parse。
- placement 改变不一定要重建几何。
- worker 输出必须是可传输的结构，而不是 Cesium 对象。

## Provider 作为缓存根对象

如果目标是“方便 GC 清理”，那所有缓存都应该以 `StyleImageryProvider` 实例为根对象持有，而不是散落在模块级单例、全局 map 或静态缓存里。

推荐理解为：

- `StyleImageryProvider` 是 runtime root owner。
- 所有 cache manager、atlas manager、worker pool、scene layer、debug state 都是它的实例字段或字段可达对象。
- 其他模块可以拆分类，但所有权必须能沿引用链回到 provider。

推荐结构：

```ts
class StyleImageryProvider {
  private _runtime;
  private _solidImageCache;
  private _sourceTileCache;
  private _parsedTileCache;
  private _renderTileCache;
  private _glyphAtlasCache;
  private _spriteAtlasCache;
  private _featureStateStore;
  private _requestTracker;
  private _sceneLayer;
}
```

这样做的好处：

- `destroy()` 时可以按确定顺序释放所有资源。
- 断开 provider 与 viewer/scene 的引用后，整棵对象树更容易被 GC。
- 不会出现“图层销毁了，但模块级缓存还挂着一堆 tile”的隐性泄漏。
- 多个 provider 并存时，缓存天然隔离，避免 source/style 串味。

这里要强调一个实现原则：

- “缓存挂在 provider 上”不等于把所有逻辑都写进 `imagery-provider.ts`。
- 正确做法是 provider 拥有这些 manager，但 manager 仍然保持职责单一。

建议至少挂在 provider 上的缓存包括：

- `solid-image-cache`
- `source-tile-cache`
- `parsed-tile-cache`
- `render-tile-cache`
- `glyph-atlas-cache`
- `sprite-atlas-cache`
- `feature-table-cache`
- `pick-cache`
- `request-tracker`
- `debug-stats`

销毁顺序建议：

1. 停止 scene 更新钩子与事件监听。
2. 取消 in-flight request 与 worker 任务。
3. 释放 draw command / primitive / collection。
4. 释放 render tile、parsed tile、raw tile。
5. 释放 glyph / sprite / pattern atlas。
6. 清空 cache map 与统计对象。
7. 断开 provider 到 scene/viewer 的最后引用。

## 渲染后端分工

建议从一开始就接受“多后端共存，但统一调度”的设计，而不是试图让一种 Cesium primitive 覆盖所有 MapLibre 图层。

| 图层类型                           | 推荐后端                      | 阶段     | 说明                                  |
| ---------------------------------- | ----------------------------- | -------- | ------------------------------------- |
| `background`                       | scene 背景色或专用全屏 pass   | 第一阶段 | 不应走 tile 几何                      |
| `fill`                             | `BufferPolygonCollection`     | 第一阶段 | 适合大批量纯色面                      |
| `line` 基础实线                    | `BufferPolylineCollection`    | 第一阶段 | 先支持纯色、基础宽度                  |
| `circle`                           | `BufferPointCollection`       | 第一阶段 | 与 MapLibre circle 最接近             |
| `symbol` 文本/图标                 | 自定义 `DrawCommand`          | 第二阶段 | 需要 atlas、quad、opacity、collision  |
| `line-dasharray`                   | 自定义 `DrawCommand`          | 第二阶段 | `BufferPolylineCollection` 不足以保真 |
| `fill-pattern`                     | 自定义 `DrawCommand`          | 第二阶段 | 需要纹理与 UV                         |
| `fill-extrusion`                   | 专用 primitive / draw command | 第三阶段 | 可结合 Cesium 3D 能力扩展             |
| `heatmap` / `hillshade` / `raster` | 暂不支持                      | 后续     | 不建议混进首批目标                    |

## Buffer\*Collection 的价值与边界

### 价值

- 专门为海量 primitive 做了 ArrayBuffer 化存储。
- `featureId`、`show`、`material` 这些状态可以按 primitive 组织。
- 适合大量小对象的内存压缩与批量更新。
- 与 Cesium 的 primitive 生命周期天然兼容。
- `VectorGltf3DTileContent` 已经证明 Cesium 内部也在用这条思路承接向量内容。

### 边界

- 材质能力偏基础，主要是 fill / outline / width / point size。
- 不能直接表达 MapLibre 的 SDF 文本、sprite icon、pattern fill、复杂混合和 dash。
- collection 不可动态 resize，容量规划必须前置。
- 线型的 cap/join/antialias 风格未必能完全对齐 MapLibre。

### 实施建议

- worker 先做统计，再让主线程一次性按精确容量分配 collection。
- 默认尽量 `allowPicking: false`，只有需要查询/交互的 layer 再开 picking。
- `fill`、`line`、`circle` 先跑通后，再决定是否继续扩展 Buffer 后端的覆盖面。
- 不要为了支持 symbol 去硬拗 `BufferPointCollection`。

## Pass 与视觉遮挡分析

Cesium 的 `Pass` 可以解决“命令大类的执行阶段”问题，但不能被理解成“只要选对 pass，就自然解决所有图层顺序和视觉遮挡”。

现阶段可以明确的事实：

- Cesium 会按 `Pass` 顺序执行命令，直到 `TRANSLUCENT` 前都属于较明确的阶段化执行。
- `TRANSLUCENT` pass 会进入额外的排序/OIT 路径。
- `OVERLAY` 最后执行，适合 HUD 或明确要压到最上层的内容。
- 现成的 `BufferPointCollection`、`BufferPolylineCollection`、`BufferPolygonCollection` 在 Cesium 1.140 内部都被硬编码到了 `Pass.OPAQUE`，而且 render state 默认关闭 blending。

这意味着：

- `Pass` 可以帮助我们决定“在 globe 后、在 3D Tiles 前/后、在 overlay 前”这样的粗粒度阶段。
- `Pass` 本身不能表达 MapLibre 细粒度的 layer order。
- 同一 pass 内仍然要关注命令生成顺序、深度测试、深度写入和透明排序。
- 如果要支持真正半透明的 `fill` / `line` / `circle`，仅依赖现成的 `Buffer*Collection` 不够，需要自定义 backend。

建议按能力划分：

- `background`
  - 不应寄希望于 `Pass` 解决
  - 更适合作为共享 imagery 占位背景色或专门背景命令

- 基础不透明 `fill` / `line` / `circle`
  - 可以先落在 `Pass.OPAQUE`
  - 依赖 depth test 与几何顺序实现与 globe/terrain 的基础遮挡关系

- 半透明面线
  - 需要自定义 `DrawCommand`
  - 走 `Pass.TRANSLUCENT`
  - 配合 blending、depthTest、depthMask 策略

- 默认 symbol
  - 更适合单独 backend
  - 大多数情况下应进入 `Pass.TRANSLUCENT`
  - 是否启用 depth test，要按“被地形/3D 遮挡”还是“始终可读”这两种模式分开设计

- 调试文字、选中描边、强制置顶标签
  - 才适合考虑 `Pass.OVERLAY`

因此，关于“Pass 能否解决渲染优先级”的结论是：

- 能解决粗粒度渲染阶段
- 能帮助处理一部分视觉遮挡
- 不能替代图层排序策略
- 不能替代透明对象的专门处理
- 不能替代 symbol 的单独渲染后端

推荐把视觉优先级拆成四个维度来设计，而不是只盯 `Pass`：

- `pass`
- `depthTest / depthMask / blending`
- 同 pass 内命令顺序
- symbol / overlay 的单独规则

## Cesium 侧必须新增的适配层

MapLibre 的很多逻辑假定存在一个平面地图 `transform`。在 Cesium 中必须补一个“视图适配层”。

建议对象：

- `view-state.ts`
- `render/placement/transform-adapter.ts`

它要输出的不是“Cesium camera 原始值”，而是供样式与 placement 使用的统一视图状态，例如：

- canvas 宽高
- 当前中心点 cartographic
- 参考 zoom
- 参考 meters-per-pixel
- 近似 bearing
- 近似 pitch
- cameraToCenterDistance 等效量
- 视锥与地球交线信息
- 当前帧 style evaluation 时间戳

注意点：

- MapLibre 的 zoom 是单一标量，Cesium globe 上屏幕不同位置的地面分辨率并不相同。
- 第一版可以用屏幕中心点的地面分辨率作为 reference zoom。
- 样式求值可以按 reference zoom 统一算，但 symbol 的 screen-space collision 仍要按实际投影结果处理。
- 低空、近地、倾斜视角、跨大范围视图时，需要接受“中心 zoom 近似”并不完美。

## Globe 几何与 WebMercator 几何的关键差异

这是整个方案成败的核心之一。

### 1. tile 内长边需要细分

MVT 几何原本是在投影平面内定义的。把低层级 tile 的长边直接转成球面上的少量 Cartesian 顶点，会出现：

- 边界弯曲不自然
- 多边形边线与 Mercator 直线不一致
- 远距离时出现明显折线感

因此建议：

- 所有 `line` 与 `fill` 边界在投影到 globe 前做自适应细分
- 细分条件基于 chord error、角度变化或 screen-space error
- 同一 tile 边界与相邻 tile 使用一致规则，避免裂缝

### 2. tile buffer 与裁剪策略要保留

MapLibre 的 tile 处理天然包含 buffer 概念，用来保证：

- 线连接不断裂
- symbol 可跨 tile 边界排布
- polygon 裁剪不出缝

Cesium 方案里也应该保留这个概念：

- parse 保留 buffer 区域几何
- render 视需要在 tile bounds 内裁剪或仅在 query 中考虑
- symbol placement 用 buffer 几何，最终显示结果按可见性裁切

### 3. 地形与深度关系不能后补

一开始就要定义清楚：

- 第一阶段是否只贴 ellipsoid
- 是否允许 terrain
- 与 3D Tiles 之间是否需要 depth test
- label 是否遮挡在山体后面

推荐分阶段：

- 第一阶段：贴 ellipsoid，少量法向偏移，避免 z-fighting。
- 第二阶段：接 terrain elevation，支持基础 clamp。
- 第三阶段：再处理 3D Tiles 遮挡、深度查询与更精细的 label 可见性。

## MapLibre 可移植阶段建议

推荐借鉴下面这条阶段链：

`style -> style layer index -> layer family -> feature filter -> bucket populate -> glyph/icon dependencies -> symbol layout -> placement -> query`

对应到本项目：

### style 与 layer family

可借鉴：

- `StyleLayerIndex`
- `groupByLayout`
- filter / expression / property evaluation

需要 Cesium 化的点：

- source 生命周期
- style 变更后的 invalidation 语义
- 与 scene render order 的映射

### worker tile parse

可借鉴：

- `WorkerTile.parse` 的阶段组织
- bucket 的 populate 流程
- glyph / icon / pattern / dash 依赖收集
- `FeatureIndex` 构建思路

需要 Cesium 化的点：

- worker 输出不要带 WebGL 对象
- 输出尽量是 typed arrays + stats + metadata
- geometry 需要为 globe 投影准备好足够信息

### symbol 系统

可借鉴：

- `symbol_layout`
- `CollisionIndex`
- `Placement`
- `CrossTileSymbolIndex`

需要 Cesium 化的点：

- transform 适配
- 地形高程获取
- 与 Cesium camera 的 frame 同步
- translucent 命令排序
- requestRender 模式下的 placement 刷新触发

## 缓存、调度与 Cesium 侧优化借鉴

这里建议重点借鉴 Cesium 自己的三类能力。

### 1. RequestScheduler 思路

应用方式：

- tile、sprite、glyph、tilejson 请求全部进统一调度
- 优先级按“当前视图是否阻塞渲染”排序
- 远离视图、被更高层级 tile 替代、style 已失效的请求要及时取消
- 可以借鉴 3D Tiles 的“视图外请求取消”和“相机移动时延迟部分请求”策略，避免瞬时平移缩放时堆积无效工作

优先级建议：

- 当前帧可见且无父 fallback 的 tile
- 当前帧可见的 symbol/glyph 依赖
- 当前帧可见 tile 的 sprite/pattern 依赖
- 父级 fallback tile
- preload siblings / ancestors
- 已经离开视图但短时间内可能回来的 tile

### 2. Cesium3DTilesetCache / TileReplacementQueue 思路

建议把 cache 管成真正的 LRU，而不是“见机行事塞 Map 里”。

推荐借鉴的行为：

- 每帧开始先把缓存分成“本帧未触达”和“本帧已触达”
- 选中的 tile 调用 `touch`
- frame 结束后按内存预算 trim
- trim 时优先淘汰最久未使用且不阻塞当前显示的 tile

可以直接引入的策略：

- `cacheBytes`
- `maximumTiles`
- `preloadAncestors`
- `preloadSiblings`
- `loadingDescendantLimit`

### 2.1 借鉴 3D Tiles 的卸载时机判断

3D Tiles 的卸载机制有两个很值得借鉴的特点：

- “是否本帧触达”与“是否允许卸载”是两个独立条件
- 真正的 unload 发生在 pass 结束后，而不是遍历过程中立刻做

对应到 MVT 建议：

- 每帧开始先 `reset` LRU 分界
- 当前帧真正参与渲染、或作为 fallback 被使用的 tile 才 `touch`
- 在 `postRender` 或等价阶段统一做 trim / unload
- trim 时只考虑“本帧未触达”的 tile
- 只有 tile 自身 `eligibleForUnloading === true` 时，才允许真正释放资源

建议定义 `eligibleForUnloading === false` 的状态：

- 网络请求仍在进行
- worker parse 仍在进行
- GPU upload 仍在进行
- placement 正在消费该 tile 的 symbol 数据
- pick/query 结果仍持有不可替换的强引用

而不是：

- 仅仅因为 tile 暂时不在视野里就立即销毁

推荐借鉴 3D Tiles 的“软壳 + 可卸内容”思路：

- tile record 可以继续存在
- 真正被卸载的是 tile content
- 对 MVT 来说，tile record 可以保留 key、状态、统计与少量元数据
- 被卸载的内容是 render collection、draw command、typed arrays、atlas 引用等重资源

### 2.2 借鉴 3D Tiles 的请求取消机制

3D Tiles 会在 tile 请求发出后继续跟踪 in-flight 项，并对“离开视图至少一帧”的请求做取消。

这一点对 MVT 特别重要，因为：

- glyph / sprite / tile 请求是链式依赖
- 若不取消，快速平移时会积累大量过期 tile
- 这些过期 tile 即使最终成功，也只会增加 parse、upload 和 atlas 污染

建议直接引入：

- `requestedTilesInFlight`
- `requestedGlyphsInFlight`
- `requestedSpritesInFlight`

并在每帧结束后：

- 取消本帧未 `touch` 的 in-flight tile 请求
- 清理已经完成或失败的请求句柄
- 对相机快速移动场景，引入类似 `cullRequestsWhileMoving` 与 `foveatedTimeDelay` 的节流策略

也就是：

- 先避免请求无效 tile
- 再对已经无效的请求快速取消
- 最后才谈 unload

### 2.3 内存预算与安全红线

缓存、性能、内存安全应该作为第一优先级约束，而不是后期优化。

建议从第一版开始就有明确预算：

- `sourceTileCacheBytes`
- `parsedTileCacheBytes`
- `renderTileCacheBytes`
- `glyphAtlasCacheBytes`
- `spriteAtlasCacheBytes`
- `maximumCacheOverflowBytes`

同时要求：

- 所有 cache entry 都能估算 `byteLength`
- 每类资源都能独立统计与独立 trim
- trim 触发后要先回收 render 资源，再决定是否回收 parsed/raw 资源
- 任何异步结果在落地前都要校验 `provider destroyed`、`style-epoch matched`、`tile still needed`

建议明确禁止：

- module-level 全局缓存
- worker 输出再 clone 一份大对象到主线程
- atlas 无上限增长
- style 切换后旧 epoch 数据继续写回当前 provider

### 3. Quadtree / tile selection 思路

长期建议不要完全依赖 ImageryLayer 的 raster 语义做 tile 选择，而是把 `QuadtreePrimitive` 和 `3D Tiles traversal` 当成两个参考样本：

- `Quadtree` 更适合借鉴“每帧可见性遍历、showTileThisFrame、父子 refine、渐进显示”
- `3D Tiles` 更适合借鉴“touch、request priority、fallback、请求取消、trim/unload”

更适合本项目的做法是混合两者：

- 使用 Cesium 同样的 tiling scheme
- 基于屏幕误差、视图覆盖率、source 级别范围估算 target level
- 保留父级 tile 作为 fallback
- 在 refine 过程中控制“渐进细化”而不是整屏闪切
- 把 selected / shown / touched / unloadable 显式拆开

同时要明确 3D Tiles 只是参考，不是直接套用模型：

- 3D Tiles content 的“可见”更偏几何内容本身
- 本项目还要处理 symbol placement、cross-tile 稳定性、style layer order
- 因此遍历框架可以借鉴，但最终状态机必须偏向 Cesium 地图图层这一侧

## 样式变更与增量更新策略

这一块如果前期设计不好，后面会很痛。

建议从一开始区分三种变更：

### 1. paint 变更

例如：

- fill-color
- line-color
- circle-radius
- text-color

处理：

- 尽量只更新材质或 uniform
- 不重新 parse tile
- 不重新构建几何

### 2. layout 变更

例如：

- text-field
- symbol-placement
- text-font
- line-cap

处理：

- bucket 失效
- symbol layout 失效
- 需要重新 parse / rebuild

### 3. source / style 结构变更

例如：

- source url 改变
- source-layer 改变
- layer 新增删除排序改变

处理：

- source cache 失效
- render tile 全量失效
- cross-tile symbol state 需要重建

建议显式维护一个 `style-epoch`，所有 render tile 和 placement 都挂在这个 epoch 下。

## Symbol 与文本的实现建议

这部分是最难的，但也是区分“能跑”和“能用”的关键。

### 第一原则

symbol 不要挤进 BufferCollection 体系里，应该尽早独立成专门 backend。

### 建议路径

1. 先支持 point symbol，不碰 line symbol。
2. 跑通 sprite icon + text shaping + atlas + quad 绘制。
3. 接入 collision 与 cross-tile id。
4. 再支持 variable anchor、text-fit、icon-text-fit、fade。
5. 最后才做 line-placement、terrain-aware placement、复杂国际化细节。

### 原因

- point symbol 已经能覆盖大量基础地图样式。
- line symbol 对 globe 和透视投影的适配更难。
- 先把点标注稳定住，能快速验证 transform adapter 与 collision 系统。

### 具体建议

- glyph / sprite atlas 独立管理，支持引用计数与 trim
- symbol quad 的几何与 opacity buffer 分离
- cross-tile state 不与 render tile 生命周期强绑定
- camera 轻微变化时优先重用上帧 placement 状态
- placement 只在视图变化超过阈值时重算，避免每帧全量重排

## Query / Picking 建议

既然入口是 `ImageryProvider`，建议同时支持两套查询语义，但内部共用一个查询服务。

### 1. `pickFeatures`

用于兼容 imagery provider 的经纬度查询语义。

### 2. `scene.pick`

用于 Cesium 原生的屏幕空间 picking。

内部建议统一成：

- `featureId -> feature table entry`
- `tile + bucket + local feature index -> source feature`

可借鉴 MapLibre 的 `FeatureIndex` 思想，但要按 Cesium 输出收敛。

建议：

- `fill` / `line` / `circle` backend 记录 featureId
- `symbol` backend 维护独立 pick pass 或 pick color
- 查询结果统一转成项目自己的 feature info，再按需要包装成 `ImageryLayerFeatureInfo`

## 额外值得做的内容

除了你已经提到的内容，我认为下面这些也很值得提前纳入设计：

- `feature-state` 支持
  - 这会直接影响未来高亮、hover、选中和动态图层表现

- style 热更新与 diff
  - 不要把 style 变更实现成全量销毁重建

- GeoJSON source 统一接入
  - 既然已经有 `@maplibre/geojson-vt` 依赖，建议 source 抽象一开始就兼容 geojson tile 化

- 多 source 统一调度
  - 同一个 style 往往不止一个 source，cache 与请求必须全局协调

- glyph / sprite / pattern 统一资源预算
  - 这些资源经常比 tile 几何更容易失控

- debug 可视化
  - tile 边框
  - tile id
  - collision boxes
  - symbol anchors
  - cache hit / miss
  - atlas 占用
  - draw command 数量

- 性能指标面板
  - parse time
  - upload time
  - placement time
  - rendered tiles
  - pending requests
  - cache bytes
  - glyph atlas bytes
  - sprite atlas bytes

- overzoom / underzoom 策略
  - raw tile 与 render tile 分离后，这一层会非常自然

- wrap / antimeridian 稳定性
  - 尤其是 symbol 的 cross-tile 稳定性

- terrain-aware symbol
  - `Placement` 里本身就有 elevation 接口思路，可以作为中期增强方向

- fill-extrusion
  - 一旦基础 2.5D 管线稳定，这是 Cesium 天然比 MapLibre 更有发挥空间的地方

- style layer order 到 Cesium render order 的严格映射
  - 不能因为批处理就把图层顺序打乱

- 视图阈值驱动的 placement 节流
  - camera 每一帧都动时，全量重排会非常贵

- worker transferable 优化
  - typed arrays 尽量 transfer，不要 clone

- unsupported layer 的显式告警
  - 风险早暴露，不要静默失败

## 不建议做的事情

- 不建议先把 MVT 全部 rasterize 到 canvas，再贴回 imagery，除非只是做对照验证。
- 不建议长期直接 import MapLibre 私有源码路径作为生产依赖。
- 不建议为了兼容试验过程而保留两套 style evaluator。
- 不建议把 symbol 也强行塞进 BufferCollection。
- 不建议一上来就做跨 tile 全局 mega batch。
- 不建议在没有 debug 指标的情况下盲做缓存优化。

## 分阶段实施路线

### 阶段 0：定边界与脚手架

目标：

- 跑通 `StyleImageryProvider` 的 style url 加载
- 初始化 `scene-layer`
- 建立 provider facade 与 scene renderer 的生命周期关系

产出：

- style loader
- source model
- scene layer 基础壳
- 透明占位图像策略

验收：

- viewer 中可成功加载 style
- scene layer 正常初始化与销毁
- requestRender 模式下不会卡死

### 阶段 1：基础几何渲染

目标：

- 支持 `background`、`fill`、基础 `line`、`circle`
- worker 可输出 bucket stats 和 typed arrays
- 主线程可用 Buffer backend 渲染

产出：

- fill/line/circle bucket builder
- globe 投影与边细分
- `BufferPolygonCollection`
- `BufferPolylineCollection`
- `BufferPointCollection`

验收：

- 能正确渲染开源 bright style 中的基础地物
- tile 切换无明显闪烁
- cache 可工作

### 阶段 2：缓存、查询、增量更新

目标：

- 建立 LRU、trim、request priority
- 支持 `pickFeatures` 与基础 `scene.pick`
- 支持 paint diff

产出：

- tile cache
- request queue
- feature index
- query service

验收：

- 反复平移缩放内存不持续上涨
- tile 离开视图后可按预算回收
- paint 变更不触发全量重建

### 阶段 3：symbol 系统

目标：

- 支持 point symbol 文本与图标
- 支持 atlas、placement、collision、cross-tile 稳定性

产出：

- glyph manager
- sprite manager
- symbol draw command backend
- transform adapter
- placement state

验收：

- 点标注可稳定显示
- 缩放与平移时无明显 label 闪烁
- 碰撞结果基本符合 style 预期

### 阶段 4：复杂样式与 Cesium 强化

目标：

- 支持 dash / pattern / 更完整的 line / fill 样式
- 评估 line symbol
- 接 terrain
- 评估 fill-extrusion

产出：

- 自定义 pattern backend
- 自定义 line shader/backend
- terrain-aware placement
- 2.5D / 3D building 实验

验收：

- 能覆盖主流矢量底图 style 的大部分图层
- 复杂样式下 draw call 与内存仍可控

## 风险与重点决策

### 风险 1：把 ImageryProvider 当成最终承载层

问题：

- 会持续受 raster 语义约束
- 后续很难把 tile cache、placement、GPU 生命周期做干净

决策：

- 只把它当 facade，不把核心渲染逻辑塞进去

### 风险 2：直接依赖 MapLibre 私有运行时

问题：

- 升级脆弱
- browser map 假设太重
- 很难收敛到 Cesium 语义

决策：

- 选择性移植关键模块，形成受控的 `maplibre-port`

### 风险 3：过早追求完整 style 覆盖

问题：

- symbol、dash、pattern、extrusion 同时推进会失控

决策：

- 先做基础几何，后做 symbol，再做复杂样式

### 风险 4：忽视 globe 差异

问题：

- 很多“平面地图上成立”的假设在 globe 上会失真

决策：

- 明确增加 Cesium 视图适配层
- 明确几何细分、terrain、depth 策略

### 风险 5：没有指标就做优化

问题：

- 最终很可能得到一堆经验补丁，而不是结构性优化

决策：

- debug overlay 与性能指标和首批渲染功能同步建设

## 建议的首版 public API

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

建议后续再补：

- `updateStyle(style)`
- `setFeatureState(...)`
- `queryRenderedFeatures(...)`
- `trimCache()`
- `destroy()`

## 实现时的工程约束

- worker 输出只传纯数据，不传 Cesium 对象
- backend 只消费统一的 render bucket，不直接依赖原始 PBF
- 所有图层顺序都要可追踪
- cache 与 atlas 都必须有 byte 级预算
- provider / scene layer / cache / backend 的销毁路径必须完整
- 新增功能必须自带 debug 开关与指标

## 测试与验证建议

实现过程中建议同步补下面这些测试：

- style loader
  - 相对路径解析
  - source / sprite / glyph URL 解析

- tile key / cache
  - canonical key
  - overscaled key
  - LRU trim
  - touch 逻辑

- geometry
  - polygon triangulation
  - line subdivision
  - tile border 一致性

- style evaluation
  - paint diff
  - layout diff
  - filter 命中

- symbol
  - collision 结果稳定性
  - cross-tile id 延续
  - placement 节流

- integration
  - camera 平移缩放
  - style 热切换
  - destroy 后资源释放

手工验证建议：

- 连续平移 5 分钟看内存是否稳定
- 高频缩放看 label 是否闪烁
- terrain 开关下看 z-fighting 与遮挡行为
- 切换 style 看是否发生全量闪断
- 打开 debug overlay 看 cache hit/miss 是否符合预期

## 最终收敛形态

最终理想形态不是“Cesium 里跑一个 MapLibre”，而是：

- 对外：一个能接收 style url 的 Cesium 图层能力
- 对内：一套以 Cesium scene、primitive、drawcommand、request scheduler、cache 语义为中心的矢量渲染系统
- 借鉴：MapLibre 在 style/bucket/placement/query 上的成熟经验
- 发挥：Cesium 在 globe、terrain、3D、海量 primitive、生命周期控制上的优势

如果按这个方向推进，后面不仅能做 MVT 底图，还能自然扩展到：

- GeoJSON source
- fill-extrusion / 3D building
- terrain-aware labels
- 与 3D Tiles 的协同表达

## 参考依据

- Cesium 1.140 官方发布说明中已明确提到实验性的 vector primitives：<https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026/>
- Cesium API 文档中的 Buffer primitive 参考：<https://cesium.com/learn/cesiumjs/ref-doc/BufferPointCollection.html>
- Cesium `QuadtreeTileProvider`：<https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/QuadtreeTileProvider.js>
- Cesium `QuadtreePrimitive`：<https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/QuadtreePrimitive.js>
- Cesium `Cesium3DTilesetTraversal`：<https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/Cesium3DTilesetTraversal.js>
- Cesium `Cesium3DTilesetBaseTraversal`：<https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/Cesium3DTilesetBaseTraversal.js>
- MapLibre `StyleLayerIndex`：<https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/style/style_layer_index.ts>
- MapLibre `WorkerTile.parse`：<https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/source/worker_tile.ts>
- MapLibre `Placement`：<https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/symbol/placement.ts>
- MapLibre `CollisionIndex`：<https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/symbol/collision_index.ts>
- MapLibre `CrossTileSymbolIndex`：<https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/symbol/cross_tile_symbol_index.ts>
- MapLibre `FeatureIndex`：<https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/data/feature_index.ts>
