# Cesium MVT 渲染方案、实现现状与阶段里程碑

本文记录 `cesium-mvt` 当前的真实实现思路、已经完成的阶段性成果、现阶段的优点与缺陷，以及仍未实现的能力。它不是愿景文档，而是给后续迭代和开源拆分准备的工作说明。

## 项目目标

这个项目的目标不是把 MapLibre GL JS 直接塞进 Cesium，而是：

- 复用 Cesium 现有的瓦片请求、场景挂载和相机生命周期
- 用 primitive / collection / draw-command 风格完成矢量渲染，而不是把矢量瓦片当贴图
- 尽量兼容 MapLibre / Mapbox 的 style、source、layer、symbol 语义
- 保持主线程轻量，能放到 worker 的工作尽量放到 worker
- 让核心代码更容易抽成开源库，demo 与业务接入保持分离

## 当前实现思路

### 1. 请求入口由 Cesium 驱动

当前把 `UrlTemplateImageryProvider` 当成调度壳，而不是最终渲染层。

- `requestImage()` 负责触发 tile demand
- 返回透明占位图，避免 imagery texture 管线成为最终渲染路径
- Cesium 的 imagery layer 主要用于复用瓦片层级、请求时机和可见性节奏

这一层的职责是“知道什么时候该请求哪个瓦片”，不是“真的把瓦片画成图片”。

### 2. 解码放到 worker

worker 负责 MVT 解码，主线程只消费解码结果。

当前已经复用的核心库：

- `pbf`
- `@mapbox/vector-tile`

worker 侧做的事情是：

- 解码 protobuf / vector tile
- 输出 tile、layer、feature 的结构化结果
- 避免主线程承担大块解析成本

### 3. `TileScheduler` 负责请求、并发与缓存

调度层不直接知道 Cesium 画面要怎么渲染，只负责瓦片任务生命周期。

`TileScheduler` 目前承担：

- 请求队列
- 并发控制
- 解码结果缓存
- pin / unpin
- evict 通知

它的职责是让“请求”和“缓存”保持稳定，而不是让每一帧都重新组织整个世界。

### 4. `CesiumMvtSourceCache` 负责生命周期与父子复用

这一层是 Cesium 请求语义和我们自己的渲染生命周期之间的桥。

现在的策略是：

- 由 provider 请求触发 tile demand
- 请求过的 tile 会保持在 active 集里
- 父级 tile 会在子级 tile 还没稳定时继续保留
- 真正退出渲染集，主要依赖真实 evict，而不是单纯按时间过期

这一层的目标是保持画面稳定，减少缩放、拖拽时的闪切和空档。

### 5. 样式编译独立出来

MapLibre / Mapbox style 解析不是写死在渲染层里的，而是单独编译成中间表达。

当前已经拆出的部分：

- `maplibre-style`
- `maplibre-style-renderer`
- `maplibre-style-expressions`

它们负责：

- 解析 style JSON
- 编译 layer/source/filter/paint/layout
- 计算 sort key、zoom 语义和 symbol 参数
- 把 MapLibre 风格的表达式转成内部可执行逻辑

### 6. 渲染层以 Cesium primitive 为核心

渲染不是单一大函数，而是按要素类型拆开的 primitive 编排。

当前大致对应关系：

- `fill` -> polygon primitive / polygon geometry
- `line` -> polyline collection
- `circle` -> point collection
- `symbol` -> text sprite atlas + billboard collection

几何和纯计算逻辑继续拆成了小模块，例如：

- `feature-preview-geometry`
- `feature-preview-symbols`
- `screen-space`

### 7. 符号系统做了基础的 placement / collision / dedupe

现在已经有的能力包括：

- 屏幕空间碰撞索引
- 符号去重索引
- sprite atlas
- text sprite atlas
- 文本换行、transform、anchor、justify、offset
- icon / text 的基础 placement

但这仍然只是 MapLibre / Mapbox placement engine 的近似实现，不是完全等价实现。

## 当前实现的优点

### 1. 结构比“大杂烩式实现”清楚

请求、缓存、解码、样式、几何、符号、碰撞各自有边界，后面做开源拆分时不会从一开始就绑死在一个文件里。

### 2. Cesium 的能力复用比较完整

我们复用了 Cesium 的：

- 场景与相机
- imagery 请求时机
- primitive / collection / appearance 体系
- tile 生命周期挂载点

这比自己从零造一个地图场景要省很多成本。

### 3. worker 只放真正值得下沉的活

当前不是把所有东西都拆到 worker 里，而是只把解码、部分 style 预计算等收益高的内容下沉，避免过度设计。

### 4. 对 MapLibre / Mapbox 兼容性有明确入口

style 解析、表达式、symbol 语义都有专门层，不是写死在 demo 里。

### 5. 开源化边界比较清楚

核心逻辑不依赖某个具体站点，demo 和业务接入可以单独拿掉，适合后面直接抽成库。

## 当前缺陷与风险

### 1. 渲染效果还没有完全对齐 MapLibre / Mapbox

当前很多地方是“接近”而不是“像素等价”：

- 文字排版
- 图标 placement
- 背景、边框、透明度
- label background / halo
- symbol 的优先级与 collision

这意味着同一份 style，在 Cesium 和 MapLibre 里仍会有肉眼可见差异。

### 2. symbol engine 还不完整

目前已有基础 placement，但还缺完整的：

- cross-tile symbol index
- 更严格的碰撞状态机
- glyph shaping
- icon / text 的完整优先级规则
- 更完整的 variable anchor 与 overlap 行为

这也是重复地名、文字叠加、文字被路盖住等问题的主要来源之一。

### 3. 渲染优先级仍是近似实现

当前依赖：

- style layer 顺序
- sort key
- 一部分 symbol z-order 规则
- 局部的 dedupe / collision

但还没有完整复刻 MapLibre 的 bucket / painter / collision 体系，所以复杂 style 下的遮挡顺序还会有偏差。

### 4. Cesium primitive 路径有性能上限

当前使用的是 Cesium 的 primitive / collection 体系，这条路好上手、可控，但不是专门的矢量瓦片 GPU 引擎。

在以下场景里，性能仍然可能不理想：

- 大量 label / icon
- 高频缩放和拖拽
- 大量 tile 进出
- 复杂 polygon / line 混合场景

### 5. 视图稳定性仍需继续打磨

虽然已经做了 provider-driven 生命周期和父子 tile 复用，但更细的稳定策略还没完全收敛，例如：

- 离屏瓦片是否完全暂停重绘
- 缩放临界点的层级切换抖动
- 何时应该重建 symbol，何时只做增量更新
- 更严格的 offscreen / onscreen 保留窗口

### 6. style 语义覆盖还不完整

已经覆盖了一部分 `fill / line / circle / symbol` 语义，但仍有大量 MapLibre / Mapbox style 属性没有完整实现，或者只能近似实现。

## 仍未实现或未完整实现的功能

下面这些是当前最明确的缺口。

### style / source 相关

- `raster`、`image`、`geojson` 等 source 类型的完整接入
- `feature-state`
- `queryRenderedFeatures`
- 更完整的 source/layer 多源分流
- 更完整的 style 兼容与迁移逻辑

### symbol / text / icon 相关

- 完整的 glyph shaping
- 更接近 MapLibre 的 SDF 字体链路
- 更完整的 icon atlas 行为
- `icon-text-fit` 的严格对齐
- `text-variable-anchor` 的完整策略
- `text-background` / `icon-background` 这类更细的视觉规则
- 更完整的 cross-tile 去重和排序

### 几何与渲染相关

- `fill-extrusion`
- `line-gradient`
- `line-dasharray`
- `terrain drape`
- 更完整的 pitch / depth 语义
- 更接近 MapLibre 的批处理与 painter pass

### 性能相关

- 更细粒度的增量更新
- 更稳定的 offscreen tile 管理
- 更强的 worker-side 预计算
- 更少的主线程重建
- 更细的渲染层分块与懒加载

## 代码组织现状

`src/mvt/` 现在已经按职责拆开，核心分组大致是：

- `runtime` / `tile-scheduler` / `tile-cache`
- `imagery-provider` / `source-cache`
- `maplibre-style` / `maplibre-style-renderer` / `maplibre-style-expressions`
- `feature-preview-layer` / `feature-preview-geometry` / `feature-preview-symbols`
- `label-collision` / `symbol-dedupe` / `screen-space`
- `sprite-atlas`
- `worker-client` / `worker/vector-tile.worker.ts`

这个拆分原则是：

- 纯计算尽量拆成独立小模块
- Cesium 绑定保留在主线程编排层
- worker 只放真正有收益的重活
- 不做过度抽象，不提前设计还没必要的层

## 已复用的外部库

当前核心依赖主要是：

- `cesium`
- `unplugin-cesium`
- `pbf`
- `@mapbox/vector-tile`
- `@maplibre/maplibre-gl-style-spec`
- `earcut`

它们分别用于：

- Cesium 场景、primitive、资源挂载
- Cesium 静态资源打包
- MVT protobuf 解码
- MVT layer / feature 访问
- MapLibre 风格与表达式编译
- polygon 三角化

## 阶段性里程碑

### 已完成

- Cesium 作为场景与请求调度底座
- provider 驱动的瓦片请求链路
- worker MVT 解码链路
- style 编译层独立
- primitive 渲染层与 symbol 基础系统拆分
- demo / core 的边界开始清晰

### 进行中

- 让渲染行为更接近 MapLibre / Mapbox
- 收紧 symbol 的碰撞、优先级和跨瓦片去重
- 进一步稳定 tile 生命周期和 offscreen 处理
- 降低高频镜头变化时的主线程压力

### 下一阶段建议

下一阶段建议优先做真正高价值的事情，而不是继续盲目堆复杂度：

1. 补齐 symbol / text / icon 的关键规则
2. 继续收紧渲染优先级和跨瓦片去重
3. 做更稳定的 tile retention / offscreen pause 策略
4. 把更多纯计算继续下沉到 worker
5. 逐步把核心 API 抽成可独立开源的库形态

## 结论

当前实现已经不是“概念验证”级别，而是一个可以继续打磨的结构化原型。

它的价值在于：

- 路径清晰
- 复用 Cesium
- 兼容 MapLibre / Mapbox 思路
- 便于后续开源拆分

它的短板也同样明确：

- 还没完全对齐 MapLibre / Mapbox 的渲染效果
- 符号与优先级还不完整
- 性能仍有优化空间
- 一些 style 语义还在补齐中

后续迭代的重点，应该放在：

- 兼容性
- 稳定性
- 性能
- 可开源性

而不是继续增加不必要的抽象层。
