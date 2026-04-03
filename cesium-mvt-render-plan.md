# Cesium MVT 渲染方案与阶段里程碑

本文记录当前 `cesium-mvt` 的设计边界、已完成的阶段性里程碑，以及下一阶段的推进方向。

## 目标

本项目的目标不是把 MapLibre GL JS 直接搬进 Cesium，而是：

- 复用 Cesium 现成的瓦片层级、请求时机和生命周期管理能力
- 使用 primitive / draw-command 风格渲染，而不是 imagery 贴图渲染
- 尽量兼容 MapLibre / Mapbox 的 style、source、symbol 语义
- 保持主线程轻量，把真正适合离线化的工作放到 worker

## 当前阶段状态

目前已经完成的核心里程碑是：

1. `UrlTemplateImageryProvider` 只承担调度壳职责
2. `TileScheduler` 负责请求、并发、缓存和 pin/unpin
3. `CesiumMvtSourceCache` 负责 provider 驱动的视图生命周期和父子瓦片复用
4. `CesiumMvtPrimitiveLayer` 负责真正的 primitive 构建与 symbol 处理
5. `mvt/` 核心代码已经按职责拆分为 geometry、symbol、style expression、collision、dedupe 等小模块

这意味着当前实现已经不再把“加载瓦片”和“渲染瓦片”混在一个大文件里，而是分成了可维护的核心层。

## 当前架构

### 1. 调度层

Cesium 的 imagery 管线只用于决定瓦片请求时机。

- `requestImage()` 触发 tile demand
- 返回透明占位图
- 不把真正的绘制放进 imagery texture pipeline

### 2. 解码层

worker 负责 MVT 解码，主线程只消费已解码结果。

当前已经接入：

- `pbf`
- `@mapbox/vector-tile`

worker 的职责是：

- 解码 protobuf / vector tile
- 输出 tile / layer / feature 结构
- 保持 decode 逻辑远离主线程

### 3. 样式层

MapLibre / Mapbox style 解析保持为独立的编译层。

当前支持：

- `sources`
- `layers`
- `filter`
- `paint`
- `layout`
- `minzoom` / `maxzoom`
- `symbol` 相关基础表达式

### 4. 渲染层

渲染层以 Cesium primitive 为核心：

- `fill` -> polygon primitive
- `line` -> polyline collection
- `circle` -> point collection
- `symbol` -> label / billboard 组合

### 5. 符号与碰撞

当前已经有：

- screen-space collision index
- symbol dedupe index
- sprite atlas
- label / icon 的基础 placement

这些能力还不等于完整的 MapLibre placement engine，但已经能覆盖当前的核心展示需求。

## 代码组织

`src/mvt/` 现在按职责分层：

- `runtime` / `tile-scheduler` / `tile-cache`：调度和缓存
- `imagery-provider` / `source-cache`：Cesium 侧的触发和生命周期
- `maplibre-style` / `maplibre-style-renderer` / `maplibre-style-expressions`：style 编译
- `feature-preview-layer` / `feature-preview-geometry` / `feature-preview-symbols`：primitive 编排与纯计算
- `label-collision` / `symbol-dedupe` / `screen-space`：屏幕空间索引
- `sprite-atlas`：图标资源
- `worker-client` / `worker/vector-tile.worker.ts`：worker 通信与解码

这个分层的原则是：

- 纯计算独立成小模块
- Cesium 绑定留在主线程编排器里
- worker 只放真正有收益的重活，不做过度拆分

## 已复用的库

当前已经在用的关键依赖：

- `cesium`
- `unplugin-cesium`
- `pbf`
- `@mapbox/vector-tile`
- `@maplibre/maplibre-gl-style-spec`
- `earcut`

这些库分别承担：

- Cesium 场景与 primitive
- Cesium 静态资源打包
- MVT protobuf 解码
- MVT layer / feature 访问
- style / expression 编译
- polygon 三角化

## 仍然可以继续做的事

下一阶段建议只做真正有价值的优化，不过度设计。

### 1. 进一步收紧 symbol placement

- 更完整的 cross-tile 去重
- 更接近 MapLibre 的 symbol priority
- 更完整的 icon / text overlap 规则

### 2. 继续减轻主线程压力

- 把更稳定的 style 预计算下沉到 worker
- 避免在高频镜头变化中做不必要的重建

### 3. 补齐更多 style 语义

- 更完整的 `fill` / `line` / `circle` 细节
- 更高覆盖度的 `symbol` / `text` / `icon` 规则
- 后续再考虑 `geojson-vt`、`supercluster`、`tiny-sdf`

## 不建议的方向

- 不建议把最终渲染重新塞回 imagery texture 管线
- 不建议把整个 MapLibre / Mapbox renderer 原样嵌入 Cesium
- 不建议把每个 feature 都拆成一个 primitive
- 不建议把镜头每一帧的变化都变成整层重建

## 结论

当前阶段的里程碑已经达成：

- Cesium 负责请求与场景挂载
- 自己的 runtime 负责瓦片、缓存和生命周期
- style / geometry / symbol 逻辑已经拆成可维护模块

后续推进的重点是：

- 更像 MapLibre / Mapbox 的 placement 规则
- 更稳的 symbol 优先级
- 更少的主线程负担
- 适度下沉到 worker，但不做过度设计
