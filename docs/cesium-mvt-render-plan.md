# Cesium MVT 渲染方案说明

本文描述的是一个面向 MapLibre 风格矢量瓦片的 Cesium 渲染方案，重点是：

- 复用 Cesium 现成的瓦片层级、可见性判断、请求时机和生命周期管理能力
- 最终渲染不走贴图管线，而是走 primitive / draw-command 体系
- 保持高性能，尽量把主线程压力压到最低
- 兼容 MapLibre 风格的 source / layer / expression 语义

## 1. 方案定位

这里的 `UrlTemplateImageryProvider` 不是最终渲染器，而是一个“调度壳”。

它负责的事情是：

- 告诉系统当前应该请求哪些 `z/x/y` 瓦片
- 复用 Cesium 自带的层级管理、视域裁剪和请求节奏
- 作为图层挂载点，让 Cesium 的 imagery 生命周期帮我们驱动瓦片进入和退出

它不负责的事情是：

- 不负责真正的矢量绘制
- 不负责把 MVT 直接变成纹理图
- 不负责 feature 的布局、批处理和 draw command 生成

真正的渲染层应当独立实现，并挂接到 Cesium 的 primitive 系统中。

## 2. 总体流程

推荐的处理链路如下：

`MapLibre Style JSON -> Source 解析 -> 瓦片调度 -> Worker 解码 -> 几何/样式编译 -> Primitive 提交 -> Cesium Scene 渲染`

更细一点可以拆成 7 步：

1. 读取 MapLibre style JSON，提取 `sources`、`layers`、`filter`、`paint`、`layout`、`feature-state` 相关信息。
2. 为每个 vector source 创建一个 Cesium 调度壳，用来复用瓦片层级和请求时机。
3. Cesium 根据相机位置和缩放级别决定哪些 tile 进入请求队列。
4. `requestImage` 触发 tile job，但返回透明占位图，不把渲染压力放进 imagery pipeline。
5. Worker 线程解码 MVT，完成 feature 过滤、表达式预计算、几何拆分和 batching。
6. 主线程把 worker 产出的几何数据转换成 Cesium primitive / appearance / command 需要的输入。
7. 根据相机变化和 tile 生命周期做增量更新、回收和 LOD 切换。

## 3. 技术方案

### 3.1 调度层

调度层建议基于 `UrlTemplateImageryProvider` 设计一个“影子 provider”：

- 保留 `z/x/y` 层级语义
- 保留 tile 的可见性和请求节奏
- 保留与 Cesium imagery 系统的挂接方式
- 把 `requestImage` 当成“瓦片进入视野”的通知点

这层的核心目标不是返回图片，而是复用 Cesium 已经成熟的瓦片调度能力。

### 3.2 解码层

解码层建议放在 Worker 中完成，避免主线程承担 MVT 解析和样式计算。

这里主要做：

- 解码 protobuf / vector tile 数据
- 识别 `source-layer`
- 应用 `filter`
- 处理 `minzoom` / `maxzoom`
- 计算表达式结果
- 输出适合 GPU 批处理的数据结构

如果后续要支持文本和图标，还需要额外处理：

- glyph atlas
- sprite atlas
- 碰撞检测
- label 排布

### 3.3 渲染层

渲染层不走 imagery texture，而走 Cesium primitive 体系。

典型映射思路是：

- `fill` -> `Primitive` 或地表相关 primitive
- `line` -> `GroundPolylinePrimitive` 或自定义线段 primitive
- `circle` -> 点集合或自定义 quad primitive
- `symbol` -> 后续再做，更适合独立的 glyph / billboard / label 子系统

这里的重点是“按 tile 和按 bucket 批处理”，不要按 feature 粒度生成大量 primitive。

### 3.4 生命周期与 LOD

为了保证帧率，必须有明确的 tile 生命周期控制：

- 父 tile 先保底显示
- 子 tile 准备好以后再替换
- 不要因为摄像机微小变化就反复销毁和重建
- 用 LRU 或引用计数管理几何和 GPU 资源

这也是复用 Cesium 层级能力的关键原因之一。

### 3.5 交互与状态

MapLibre 的交互能力不能只靠 Cesium imagery 解决，建议单独做状态层：

- `feature-state`：用于 hover / select / highlight
- `promoteId`：用于稳定识别 feature
- `queryRenderedFeatures`：用于命中查询
- `pick`：由自己的空间索引或 GPU picking 体系处理

交互层应尽量避免触发整 tile 重建，最好只是更新少量状态。

## 4. 建议依赖

### 4.1 当前项目已有依赖

当前仓库里已经有以下基础依赖，足够作为项目骨架：

- `cesium`
- `unplugin-cesium`
- `vite`
- `vue`
- `typescript`

这部分主要负责：

- Cesium 静态资源处理
- Vue 页面承载
- TypeScript 开发体验
- Vite 构建和开发服务

### 4.2 核心功能建议依赖

如果要真正做 MapLibre 兼容的 vector renderer，建议补充以下库或能力：

- **MVT 解码**：`pbf`、`@mapbox/vector-tile` 或同类方案
- **几何三角化**：`earcut`
- **空间索引 / 碰撞检测**：`rbush` 或同类结构
- **Worker 通信**：`Comlink`，用于简化主线程与 worker 的消息往返

### 4.3 可选增强依赖

如果后续要补完整的 MapLibre 体验，可以考虑：

- **style-spec 解析 / 校验**：MapLibre style-spec 解析器或自研校验层
- **文本 SDF**：`tiny-sdf` 一类的字形距离场方案
- **图标 atlas**：sprite 管理工具
- **性能监控**：自定义 frame budget / tile budget 统计

### 4.4 可复用的 Mapbox 生态子库

如果你说的“Mapbox 相关子库”是指 MVT、PBF、切片、三角化、聚类这一层，那么也完全可以复用，而且很适合放进我们的 worker / 编译链路里。

建议优先考虑这些包：

- **`pbf`**：protobuf 编解码基础库，适合做 MVT 的底层二进制解析
- **`@mapbox/vector-tile`**：把 Mapbox Vector Tile 解析成 layer / feature 结构
- **`geojson-vt`**：把 GeoJSON 切成 vector tile，适合统一本地数据管线
- **`earcut`**：做 polygon triangulation，适合 fill、extrusion 和地表几何的三角化
- **`@mapbox/tiny-sdf`**：生成 glyph 的 SDF，适合后续文本渲染
- **`supercluster`**：做点聚类，适合高密度点数据的前端聚合

这批库的共同点是：

- 都是独立可安装、可替换的子库
- 可以放在 worker 里执行，避免主线程压力
- 更适合当“数据处理工具链”，不适合直接当 Cesium 的渲染后端

Mapbox GL JS 自己的 `package.json` 里也能看到这类依赖，例如 `@mapbox/vector-tile`、`pbf`、`geojson-vt`、`earcut`、`@mapbox/tiny-sdf` 等，这说明它们本身就是成熟的底层构件，而不是只能绑定在单一引擎里的内部实现。

## 5. 复用 Cesium 的哪些能力

建议复用的 Cesium 能力主要有：

- `UrlTemplateImageryProvider`：复用瓦片层级、请求时机和 URL 模板语义
- `ImageryLayerCollection`：复用图层挂载、顺序和显示隐藏事件
- `Globe.tileLoadProgressEvent`：用于感知当前视图的加载压力
- `Primitive` / `GroundPrimitive` / `GroundPolylinePrimitive`：作为真正的渲染载体
- `Appearance`：承载自定义 shader 和渲染状态

这些能力可以让我们少造一套调度框架，把精力集中在矢量渲染本身。

## 6. 不建议做的事

- 不建议把最终图形结果塞回 imagery texture 管线
- 不建议在主线程做大规模 MVT 解码
- 不建议按 feature 创建 primitive
- 不建议每次相机轻微变化都重建整层数据
- 不建议把 picking、feature-state 和渲染完全耦合

## 7. 推荐实施顺序

### 第一阶段

- 做一个 `UrlTemplateImageryProvider` 影子壳
- 建立 tile key、tile queue、tile cache
- 返回透明占位图
- 把 tile 请求时机和调度链路先打通

### 第二阶段

- 上 Worker 解码 MVT
- 完成 source / layer / filter / expression 的最小闭环
- 先支持 `fill`、`line`、`circle`

### 第三阶段

- 做批处理和 primitive 池化
- 加入 `feature-state`、hover、select
- 做 tile 的父子替换和缓存回收

### 第四阶段

- 补 `symbol`、`text`、glyph atlas、collision
- 做高阶 MapLibre 表达式和更完整的样式兼容
- 根据需要扩展到 extrusion、terrain drape 等能力

## 8. 目标验收标准

如果这个方案推进顺利，比较合理的验收标准是：

- 地图缩放和拖动时，主线程保持稳定
- 可见瓦片请求符合 Cesium 的层级和视域逻辑
- 矢量渲染不依赖 imagery 图像纹理
- 常见矢量图层在中高数据量下仍能维持接近满帧
- 交互状态变化不会引起大面积重建

## 9. 结论

这个方案的关键不是“让 imagery provider 直接画矢量”，而是“借用 Cesium 的瓦片调度和生命周期管理，另起一套 primitive 渲染后端”。

换句话说：

- Cesium 负责“什么时候加载、加载哪些瓦片”
- 你自己的系统负责“加载后怎么解码、怎么批处理、怎么画”

这是最接近高性能、可扩展、又能复用现有能力的实现路径。
