# 基于 Cesium Primitive / DrawCommand 的高性能 MVT 渲染方案

目标是参考 MapLibre 的渲染链路，在 Cesium 中做一套真正适合 3D 地球场景的 MVT 渲染能力。对外只暴露一个 `MvtImageryProvider`，但内部不能把所有逻辑塞进 provider，而是要拆成 `provider + tile-store + worker + primitive + bucket/render-core` 的结构。

实现代码统一放在 `src/mvt` 下。

## 关键结论

1. `MvtImageryProvider` 应该是外部接入层，不应该承担真正的绘制职责。
2. `requestImage` 的职责应该是“驱动瓦片生命周期”，而不是“在这里完成渲染”。
3. 真正的高性能渲染应该由一个自定义 `MvtTilesetPrimitive` 在 `update(frameState)` 中直接压入 `DrawCommand`。
4. MapLibre 最值得借鉴的是 `worker -> bucket -> upload -> draw` 这条链，而不是直接照搬它的 WebGL context/painter。
5. 首期先把 `background`、`fill`、`line`、`circle` 做扎实，`symbol`、碰撞检测、完整 sprite/glyph atlas、贴地地形跟随都放到第二阶段。

## 先明确哪些方案不要做

- 不要做 “一个 feature 对应一个 Cesium primitive/entity”。
- 不要做 “先画到 canvas 再转成栅格贴图”，这会直接丢掉矢量渲染的缩放与样式优势。
- 不要把 MapLibre 的 `Painter`、`Program`、`Context` 整套桥接进来，Cesium 已经有自己的渲染调度。
- 不要把所有 layer type 写进一个文件，必须拆 bucket、style、worker、render、cache。
- 不要为了兼容旧思路，把真正渲染逻辑继续堆在 `requestImage` 中。

## 为什么要借鉴 MapLibre

MapLibre 的核心优势不是“它能画 MVT”，而是它把 MVT 渲染拆成了几个非常清晰的阶段：

1. `vector_tile_worker_source.ts`
   负责加载 PBF、处理 overzoom、驱动 worker tile 解析。
2. `worker_tile.ts`
   负责按 `source-layer -> style family -> bucket` 组织数据，并收集 glyph/icon/pattern/dash 依赖。
3. `bucket/*`
   负责把 feature 几何和样式转成可上传 GPU 的 typed arrays。
4. `program_configuration.ts`
   负责常量样式、数据驱动样式、zoom/composite expression 的绑定策略。
5. `draw_fill.ts`、`draw_line.ts`、`draw_circle.ts`、`draw_symbol.ts`
   负责按 layer type 选择 shader、render state、buffer、纹理和 draw call。
6. `placement.ts`
   把 symbol 这种和相机强相关的布局放在主线程做增量更新，而不是在 worker 一次性定死。

这一套拆法非常适合借鉴到 Cesium 中。

## MapLibre 到 Cesium 的能力映射

### MapLibre 中的角色

- `VectorTileWorkerSource` / `WorkerTile`
- `Bucket`
- `ProgramConfigurationSet`
- `Painter.drawXxx`
- `Placement`

### Cesium 中建议的对应物

- `MvtTileLoaderWorker` / `MvtTileBuilderWorker`
- `MvtBucket`
- `MvtPropertyBinding`
- `MvtTilesetPrimitive.update(frameState)`
- 二期再做 `MvtSymbolPlacement`

### 最重要的架构调整

MapLibre 自己管理 WebGL context，所以它的主线程既能调度瓦片，又能直接 draw。Cesium 不是这样。Cesium 的正确接入点是：

- 外部通过 `ImageryLayer.addImageryProvider(new MvtImageryProvider(...))` 接入
- 内部由 `MvtImageryProvider` 持有一个 `MvtTilesetPrimitive`
- `MvtTilesetPrimitive` 被挂到 `scene.primitives`
- 每帧由 Cesium 调 `primitive.update(frameState)`，在这里完成 cull、upload、command push

所以最终对外仍然是 `MvtImageryProvider`，但真正的渲染核心一定要是自定义 primitive。

这里的 `MvtTilesetPrimitive` 建议是“实现了 `update/isDestroyed/destroy` 的自定义 primitive 对象”，而不是直接使用 `new Cesium.Primitive({ geometryInstances })`。原因是 MVT tile 会频繁进入/退出视野，走 Cesium 通用几何管线会有不必要的批处理和重建开销。

## 总体架构

```text
ImageryLayer
  -> MvtImageryProvider.requestImage(x, y, z)
    -> touch tile / ensure tile state / 返回 1x1 占位图
    -> MvtTileStore 异步发起 PBF 请求
      -> Worker 解析 style family / bucket / typed arrays
        -> 主线程接收构建结果
          -> MvtTilesetPrimitive 在 update(frameState) 中创建 GPU 资源
            -> 生成 DrawCommand
              -> Cesium 渲染
```

## 对外 API 设计

主要暴露一个 `MvtImageryProvider` 类。

```ts
new MvtImageryProvider({
  scene,
  style,
  styleUrl,
  source,
  sourceLayer,
  tilingScheme,
  tileSize,
  minimumLevel,
  maximumLevel,
  cacheSize,
  workerCount,
})
```

建议：

- `style` 支持传对象。
- `styleUrl` 支持传远程 style json。
- `scene` 必传，因为内部要管理 `scene.primitives` 和 `scene.requestRender()`。
- 如果 style 里只有一个 vector source，可以允许省略 `source`。

## `MvtImageryProvider` 的职责

`MvtImageryProvider` 推荐继承 `Cesium.UrlTemplateImageryProvider`，只复用以下能力：

- URL 模板与 `Resource`
- tilingScheme / rectangle / credit / tile size / level range
- Cesium ImageryLayer 接入方式

但要重写 `requestImage`。

### `requestImage` 应该做什么

1. 根据 `x/y/z` 计算 tile key。
2. 标记该 tile “本帧被需要”。
3. 如果 tile 尚未开始加载，则加入内部加载队列。
4. 返回一个缓存复用的 1x1 占位图。

注意：因为这里会立即返回占位图，真正的矢量瓦片下载、解析、构建并不再受 Cesium 影像贴图请求节流直接管理，所以内部必须自己维护加载队列、并发上限和取消策略。

### `requestImage` 不应该做什么

- 不应该在里面创建 WebGL 资源。
- 不应该在里面直接 push `DrawCommand`。
- 不应该把真正的 MVT 数据下载结果作为 imagery texture 返回。

### 占位图策略

- 若 style 中存在 background color，则返回对应纯色 1x1 图。
- 没有 background color 就返回透明 1x1 图。
- 按颜色缓存，避免重复创建 canvas/imageBitmap。

## 为什么 provider 内部还需要 primitive

Cesium 的 `ImageryProvider` 没有对 provider 暴露“瓦片卸载回调”。它只会不断调用 `requestImage`，但不会告诉你某个 imagery tile 何时彻底不再使用。

这意味着：

- 不能只靠 provider 做强引用计数。
- 必须内部维护自己的 tile store。
- 必须结合 “最后访问帧 + LRU + 内存上限” 做回收。
- 必须由 primitive 每帧根据当前活跃瓦片更新 GPU 资源与 draw commands。

## 建议的平铺文件结构

按你的要求，`src/mvt` 下只保留一层文件，不再继续分 `style/`、`tile/`、`worker/` 这些子目录。

推荐做法是：

- 目录只有一层
- 文件名统一使用 `mvt-` 前缀
- 通过文件名前缀表达分组，而不是继续拆子文件夹

```text
src/mvt/
  index.ts

  mvt-imagery-provider.ts
  mvt-tileset-primitive.ts
  mvt-types.ts
  mvt-constants.ts

  mvt-style-set.ts
  mvt-style-layer.ts
  mvt-style-family.ts
  mvt-filter.ts
  mvt-property-binding.ts

  mvt-tile.ts
  mvt-tile-key.ts
  mvt-tile-store.ts
  mvt-tile-cache.ts
  mvt-tile-loader.ts
  mvt-tile-queue.ts
  mvt-overzoom.ts
  mvt-feature-index.ts

  mvt-worker-pool.ts
  mvt-worker-protocol.ts
  mvt-worker-entry.ts
  mvt-style-transfer.ts

  mvt-bucket.ts
  mvt-fill-bucket.ts
  mvt-line-bucket.ts
  mvt-circle-bucket.ts
  mvt-symbol-bucket.ts
  mvt-segment-vector.ts

  mvt-render-state.ts
  mvt-shader-cache.ts
  mvt-buffer-pool.ts
  mvt-command-builder.ts
  mvt-material-key.ts

  mvt-fill-shader.ts
  mvt-line-shader.ts
  mvt-circle-shader.ts

  mvt-web-mercator.ts
  mvt-wgs84.ts
  mvt-tile-coord.ts
  mvt-clip.ts
  mvt-triangulation.ts
```

这里的重点不是文件越多越好，而是文件职责要稳定、边界要清楚。首期完全没必要一次把上面全部建出来，可以先建最小闭环那一批。

## 文件职责建议

### 对外接入层

- `mvt-imagery-provider.ts`
  对接 Cesium `ImageryLayer`，负责 `requestImage`、接入 style、持有 primitive、驱动 tile 生命周期。
- `mvt-tileset-primitive.ts`
  真正的渲染入口，负责 `update(frameState)`、GPU 资源上传、`DrawCommand` 生成与回收。
- `mvt-types.ts`
  放共享类型，避免循环依赖。

### style 相关

- `mvt-style-set.ts`
  负责 style json 加载、标准化、source 选择。
- `mvt-style-family.ts`
  负责 layer family 分组，这是对 MapLibre bucket 复用最重要的一层抽象。
- `mvt-style-layer.ts`
  负责单 layer 的 layout/paint/filter 结果。
- `mvt-filter.ts`
  负责 feature filter 编译与执行。
- `mvt-property-binding.ts`
  负责 constant/source/composite 三种绑定策略。

### tile 与缓存相关

- `mvt-tile.ts`
  单个 tile 的运行时状态对象。
- `mvt-tile-store.ts`
  tile 总控，负责查找、创建、状态推进。
- `mvt-tile-cache.ts`
  CPU/GPU LRU。
- `mvt-tile-loader.ts`
  下载 PBF、处理请求取消和错误。
- `mvt-tile-queue.ts`
  控制并发、优先级、重试。
- `mvt-overzoom.ts`
  父级 tile slice / scale / offset。
- `mvt-feature-index.ts`
  后续 `pickFeatures` 和调试统计需要。

### worker 相关

- `mvt-worker-entry.ts`
  worker 入口文件，尽量只做消息分发。
- `mvt-worker-protocol.ts`
  worker 消息协议类型。
- `mvt-worker-pool.ts`
  worker 池封装。
- `mvt-style-transfer.ts`
  把 style 压成 worker 可消费的最小结构。

### bucket 与几何构建

- `mvt-bucket.ts`
  bucket 基类或公共接口。
- `mvt-fill-bucket.ts`
  polygon triangulation、outline index。
- `mvt-line-bucket.ts`
  line extrusion、join/cap、sort key。
- `mvt-circle-bucket.ts`
  point -> quad/细分网格。
- `mvt-symbol-bucket.ts`
  二期再上，先留文件边界。
- `mvt-segment-vector.ts`
  segment 切分，避免单 buffer 超上限。

### render 相关

- `mvt-command-builder.ts`
  把 tile bucket 转成 `DrawCommand`。
- `mvt-render-state.ts`
  统一封装 fill/line/circle 的 render state 生成。
- `mvt-shader-cache.ts`
  shader variant key 与 program 复用。
- `mvt-buffer-pool.ts`
  buffer / vertex array 复用策略。
- `mvt-material-key.ts`
  将 program variant、blend、attribute layout 归一成稳定 key。

### shader 与数学工具

- `mvt-fill-shader.ts`
- `mvt-line-shader.ts`
- `mvt-circle-shader.ts`

如果 shader 规模不大，建议先直接在 `.ts` 文件里导出字符串，不必再拆 `.glsl` 子目录。

- `mvt-web-mercator.ts`
- `mvt-wgs84.ts`
- `mvt-tile-coord.ts`
- `mvt-clip.ts`
- `mvt-triangulation.ts`

这些都是纯工具文件，放平铺层级最合适。

## 首期建议先建哪些文件

不要一上来把所有文件都建出来。第一批先把最小闭环需要的文件建好即可：

```text
src/mvt/
  index.ts
  mvt-imagery-provider.ts
  mvt-tileset-primitive.ts
  mvt-types.ts

  mvt-style-set.ts
  mvt-style-family.ts
  mvt-filter.ts
  mvt-property-binding.ts

  mvt-tile.ts
  mvt-tile-key.ts
  mvt-tile-store.ts
  mvt-tile-cache.ts
  mvt-tile-loader.ts
  mvt-tile-queue.ts
  mvt-overzoom.ts

  mvt-worker-pool.ts
  mvt-worker-protocol.ts
  mvt-worker-entry.ts

  mvt-bucket.ts
  mvt-fill-bucket.ts
  mvt-line-bucket.ts
  mvt-circle-bucket.ts
  mvt-segment-vector.ts

  mvt-command-builder.ts
  mvt-render-state.ts
  mvt-shader-cache.ts

  mvt-fill-shader.ts
  mvt-line-shader.ts
  mvt-circle-shader.ts

  mvt-web-mercator.ts
  mvt-wgs84.ts
  mvt-tile-coord.ts
  mvt-triangulation.ts
```

等 `fill + line + circle` 跑通后，再补：

- `mvt-feature-index.ts`
- `mvt-buffer-pool.ts`
- `mvt-style-layer.ts`
- `mvt-style-transfer.ts`
- `mvt-clip.ts`
- `mvt-symbol-bucket.ts`
- `mvt-material-key.ts`

## 结构上的额外建议

### 不要把“逻辑分层”和“目录分层”混为一谈

目录可以只有一层，但逻辑上仍然要分清：

- provider 层
- tile 管理层
- worker 构建层
- bucket 几何层
- render 命令层

也就是说，不拆子目录不等于可以把逻辑揉成一团。

### 单层目录下的依赖方向建议

建议尽量保持下面这个依赖方向：

```text
mvt-imagery-provider
  -> mvt-tileset-primitive
  -> mvt-tile-store
  -> mvt-worker-pool / mvt-style-set
  -> mvt-fill-bucket / mvt-line-bucket / mvt-circle-bucket
  -> mvt-command-builder
  -> mvt-render-state / mvt-xxx-shader
```

反向依赖尽量禁止，比如：

- bucket 不要反向 import provider
- shader 文件不要知道 tile store
- worker protocol 不要依赖 primitive

### 文件数量控制建议

单层目录下更要克制文件数量，建议按阶段控制：

- 首期 20~30 个文件以内
- 二期再加 symbol 和 pick
- 不要为“看起来分层更优雅”拆出空壳文件

## 数据流与状态机

### Tile 状态

建议每个 tile 维护以下状态：

- `idle`
- `loading`
- `parsing`
- `parsed`
- `uploading`
- `ready`
- `failed`
- `evicted`

### Tile 记录建议字段

- `key`
- `x/y/z`
- `lastTouchedFrame`
- `lastRenderedFrame`
- `refFrameSpan`
- `cpuByteLength`
- `gpuByteLength`
- `requestState`
- `workerState`
- `gpuState`
- `buckets`
- `featureIndex`
- `rtcCenter`
- `modelMatrix`
- `boundingVolume`

## Worker 侧应该做什么

Worker 侧负责所有 CPU 重活：

1. 下载或接收 PBF `ArrayBuffer`
2. 用 `@mapbox/vector-tile + pbf` 解析
3. 按 `source-layer` 和 style family 过滤 feature
4. 构建 fill / line / circle bucket
5. 计算 overzoom 裁切
6. 做必要的 subdivision
7. 产出 transferable typed arrays

### 重要建议

不要在 worker 里直接引入完整 Cesium。Cesium 体积大、worker bundling 重、启动成本高。

worker 里只做纯数学与 typed array 构建：

- WebMercator x/y/z -> lon/lat
- lon/lat -> WGS84 ECEF
- 世界坐标 -> tile local RTC/ENU

这些数学建议直接放在 `src/mvt/mvt-web-mercator.ts`、`src/mvt/mvt-wgs84.ts`、`src/mvt/mvt-tile-coord.ts` 这类平铺文件里自己实现轻量版。

## Cesium 坐标策略

这是整个方案最关键的部分之一。

### 推荐方案

每个 tile 生成自己的局部坐标系：

1. 先把 tile extent 坐标转成经纬度
2. 再转成 ECEF 世界坐标
3. 以 tile 中心为 `rtcCenter`
4. 用 tile 局部 ENU 或 “世界坐标减 rtcCenter” 作为顶点位置
5. GPU 里通过 `modelMatrix` 或 uniform 还原到世界空间

### 为什么这样做

- 避免直接上传大数值世界坐标导致精度问题
- 避免每个顶点都走 Cesium 的高低位编码复杂路径
- 非常适合 tile 级缓存与复用

### 伪代码

```ts
u = (tileX + localX / extent) / (1 << z)
v = (tileY + localY / extent) / (1 << z)

lon = u * Math.PI * 2 - Math.PI
lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * v)))

world = lonLatToEcef(lon, lat, height)
local = world - rtcCenter
```

### 地形支持的现实结论

首期建议只做 “贴椭球体”。

如果一开始就做真正贴地形：

- 需要异步地形高度采样
- 会和 terrain LOD 强绑定
- 线/面/circle 都会变复杂
- tile 生命周期会和 terrain 生命周期耦合

这会把首期复杂度直接抬爆。

所以建议：

- 一期：贴椭球体
- 二期：做可选地形跟随抽象

## Layer Type 实现建议

### background

- 不必单独走 DrawCommand。
- 直接使用 `requestImage` 返回的 1x1 纯色占位图即可。
- 若后续要支持复杂 background pattern，再单独扩展。

### fill

借鉴 MapLibre `FillBucket`：

- `classifyRings`
- `earcut`
- 大网格拆 segment
- 需要 outline 时单独维护 line index

Cesium 侧：

- `Pass.OPAQUE` 或 `Pass.TRANSLUCENT`
- 一个 segment 对应一个 `DrawCommand`
- 颜色常量走 uniform，数据驱动颜色走 attribute

### line

必须借鉴 MapLibre 的“线转三角形挤出”思路，不能用原生 `gl.LINES`。

原因：

- WebGL 线宽能力很差，`maximumAliasedLineWidth` 通常基本不可用
- 虚线、渐变、join、cap、offset 都无法靠原生线条正确实现
- Cesium 自己对贴地线也是特殊几何路线，不是直接 `gl.LINES`

line bucket 至少要支持：

- `join`
- `cap`
- `miterLimit`
- `roundLimit`
- `line-sort-key`
- 后续扩展 `dash` / `pattern` / `gradient`

### circle

借鉴 MapLibre `CircleBucket`：

- 一个点扩成 quad 或更细粒度网格
- 支持 `circle-sort-key`
- 地图对齐时可增加 subdivision granularity

Cesium 侧 circle 很适合单独一套 shader：

- 顶点保存中心点与 extrude
- fragment shader 里做圆形裁切

### symbol

这是二期重点，首期不要硬上。

symbol 难点不在“画文字”，而在：

- glyph atlas
- sprite atlas
- shaping
- line placement
- 碰撞检测
- camera dependent placement
- fade / opacity dynamic buffer

建议路线：

1. 首期不做 symbol
2. 二期优先做 icon symbol
3. 再做 text symbol
4. 最后做 collision / variable anchor / line placement

## Style 解析建议

不要直接把完整 MapLibre style runtime 搬进来，但要借鉴它的核心思想。

### 需要保留的概念

- style layer
- source-layer
- filter
- layout
- paint
- layer family

### 建议做法

建立一个 `MvtStyleSet`：

- 负责加载 style json
- 把 layer 按 source/source-layer/type/layout-key 分 family
- 预编译 filter
- 预处理常量 paint/layout
- 提供 worker 可序列化的最小样式结构

### Property 绑定建议

借鉴 `ProgramConfigurationSet`，但做 Cesium 版本：

- `ConstantBinding`
  使用 uniform
- `SourceBinding`
  使用 attribute，按 feature 展开到顶点
- `CompositeBinding`
  使用两个 zoom stop 值加 `u_zoom_t`
- `FeatureStateBinding`
  二期再做，使用动态 buffer 更新

## MVT 数据规则

这一部分必须单独关注。很多性能和渲染 bug，不是架构问题，而是实现时把 MVT 数据默认想得过于“规整”。

下面这些规则建议直接作为实现约束写进代码设计。

### 1. 不要写自己的底层 PBF 几何解码

首期建议直接使用：

- `@mapbox/vector-tile`
- `pbf`

原因很简单：

- MVT 的 geometry 是 command stream，不是普通坐标数组
- 属性是 `keys` / `values` / `tags` 的索引结构
- 自己手写解码器非常容易在边界 case 上出错

首期真正应该自己掌控的是：

- style family
- bucket 构建
- tile 调度
- Cesium command 生成

不是重新发明 MVT 解码器。

### 2. `layer.extent` 不能写死成 4096

虽然实际生产数据里 `extent = 4096` 很常见，但实现上不能写死。

正确做法：

- 始终读取每个 source-layer 自带的 `extent`
- 后续 bucket 里的所有 tile 坐标换算都基于该 layer extent
- overzoom slice 也必须基于原始 extent 做 scale / offset

可以默认假设 4096 常见，但不能把它变成硬编码前提。

### 3. MVT 坐标是 tile 局部坐标，不是地理坐标

根据规范，MVT 存的是 tile grid 内的整数坐标：

- 局部 tile 坐标
- 左上角为原点
- `x` 向右增大
- `y` 向下增大

这和经纬度、也和很多 GIS 几何库默认的笛卡尔朝向都不同。

这会直接影响：

- polygon winding 判断
- line 法线方向
- tile extent 到 WebMercator 的换算

所以实现里要始终明确区分：

- `tileLocal`
- `mercatorNormalized`
- `cartographic`
- `ecefWorld`
- `tileLocalWorld`

不要在一个函数里混着传。

### 4. 规范不要求几何一定严格落在 `[0, extent]`

这是非常关键的一点。

规范没有把 clipping 定死，官方说明里明确提到：

- clipping 不属于规范的一部分
- 编码后的 geometry 可以超出 tile 边界
- 实际生产中通常会带 buffer

所以实现不能默认：

- 点一定在 tile 内
- 线一定只穿过 tile 一次
- polygon ring 一定完全被裁在 tile 内

这也是为什么：

- `fill` 不能直接按 “只接受 extent 内环” 处理
- `line` 必须保留 buffer 数据来做 join/cap/look-ahead
- tile ownership clipping 必须由我们自己定义

### 5. polygon ring 规则必须认真处理

MVT 2.x 对 polygon ring 的约定很明确：

- exterior ring 在屏幕坐标中应为顺时针
- interior ring 应为逆时针
- interior ring 必须直接跟在所属 exterior ring 后面

但实现上不要假设输入数据永远完美。

建议：

- bucket 中统一使用类似 MapLibre `classifyRings` 的逻辑
- 遇到退化 ring、面积接近 0 的 ring 直接跳过
- 不要自己拍脑袋用“第一个 ring 一定是外环”这种规则

### 6. simplification 和 rounding 可能让几何变坏

规范也明确提醒了一个现实问题：

- 简化和取整会让 polygon 变成无效几何
- 甚至可能反转 winding order

所以实现要有容错：

- 对面积接近 0 的 polygon 直接丢弃
- 对重复点、共线点做清理
- 对长度过短的 line 直接跳过
- `earcut` 前先做最基本的几何清洗

不要指望上游瓦片一定完全干净。

### 7. `feature.id` 是可选的，不能默认存在

`id` 在 MVT 里是可选字段。

所以实现不能默认：

- 每个 feature 都有稳定 id
- 可以直接拿 `feature.id` 做缓存 key
- `pickFeatures` 一定能返回业务主键

建议：

- 若 style 配置了 `promoteId`，优先按它提取
- 否则优先用原始 `feature.id`
- 再不行就退回 tile 内部生成的临时 id

这个规则以后做：

- feature-state
- picking
- 增量更新

时都很重要。

### 8. 属性类型不要被过早“字符串化”

MVT 属性是 key/value 表结构，value 类型可能包括：

- string
- float / double
- int / uint / sint
- bool

实现里不要为了图省事把所有属性都转成字符串，否则会直接影响：

- filter
- expression evaluate
- sort key
- feature id/promoteId

建议属性在解析后尽量保持原始 JS 类型。

### 9. 一个 tile 里可能有多个 source-layer，且部分 layer 可能缺失

这一点要按照 MapLibre 的方式处理：

- style 先按 `source-layer` 建 family
- tile 到手后，逐个 source-layer 去匹配
- tile 里不存在的 source-layer，直接跳过，不报错

不要把“style 里声明了某个 source-layer”理解成“每个 tile 一定都有它”。

### 10. feature 几何要按类型分别处理

至少要明确三类：

- Point / MultiPoint
- LineString / MultiLineString
- Polygon / MultiPolygon

建议：

- `circle` bucket 只吃 point
- `line` bucket 只吃 line
- `fill` bucket 只吃 polygon

不匹配类型直接跳过，不要做隐式容错转换。

### 11. 几何为空、未知类型、退化数据都要可跳过

生产数据里经常会遇到：

- `Unknown` type
- 空 geometry
- 只有一个点的 line
- 少于 3 个点的 polygon ring
- 全部点重合

这些都不应该把整块 tile 构建打崩。

建议 bucket 统一遵循：

- 单 feature 出错可跳过
- 单 source-layer 出错尽量降级
- 真正不可恢复时才把整 tile 标记为 failed

### 12. 不要随意重排 feature 顺序

在没有显式 `sort-key` 的情况下，建议尽量保持 tile 中原始 feature 顺序。

原因：

- 这更接近 MapLibre 的兼容行为
- 某些数据源会依赖原始顺序体现覆盖关系
- 后面做 symbol placement/pick 时也更稳定

所以建议：

- 只有在明确需要时才排序
- 排序最好限制在 bucket 内部
- 排序前保留原始 `featureIndex`

### 13. overzoom 不是简单放大坐标

overzoom 至少包含三件事：

1. 父 tile 几何放缩到目标 tile 坐标系
2. 按目标 tile 范围重新裁切
3. 保留 buffer 用于正确的 line/polygon 边界表现

也就是说：

- 不能只把坐标乘一个 scale 就结束
- 不能 overzoom 后不裁切
- 也不能裁得过死导致 join/cap 裂开

### 14. tile 边界重复不是异常，而是常态

很多人第一次做 MVT 渲染会把边界重复当成脏数据，其实不是。

这是向量瓦片的正常表现：

- 邻接 tile 会带共享 buffer 几何
- 同一条路、同一块面在相邻 tile 中都可能出现

真正要解决的问题不是“去重所有边界几何”，而是：

- 定义每个 tile 的 ownership
- 避免视觉双绘制
- 避免 join/cap/pattern 被裁坏

### 15. 首期建议先明确只支持 MVT 2.x

MapLibre 源码里也会对 `version === 1` 给 warning。

我们的实现建议更直接一些：

- 首期按 MVT 2.x 规则设计
- 发现 layer.version 不是 2 时给出警告
- 不为了兼容旧版本把核心逻辑搞复杂

这样最稳。

## MVT 规则对实现的直接影响

上面这些规则会直接落到几个模块中：

- `mvt-tile-loader.ts`
  负责 source-layer、extent、id、属性类型这些基础解析约束
- `mvt-overzoom.ts`
  负责 tile 坐标空间、slice、buffer、裁切规则
- `mvt-fill-bucket.ts`
  负责 ring 分类、退化 polygon 清理、triangulation 前预处理
- `mvt-line-bucket.ts`
  负责 buffer 几何、边界 ownership、line extrusion 输入合法性
- `mvt-circle-bucket.ts`
  负责 point 类型过滤、extent 外点的处理策略
- `mvt-feature-index.ts`
  负责临时 id / promoteId / 原始 feature 顺序

也就是说，MVT 规则不是文档背景知识，而是会直接决定代码边界。

## 几何裁切与瓦片边界

这一块必须提前设计，不然后面一定返工。

### 问题

MVT 通常带 buffer。若不处理：

- fill 可能重叠
- line 在 tile 边缘可能双绘制
- circle 可能出现边缘重复

### 建议

不要完全照搬 MapLibre 的 stencil tile clipping 方案，先走更符合当前实现阶段的“worker 侧 ownership clipping”：

1. 以 tile 内部 `[0, extent]` 为真正归属范围
2. 保留 buffer 数据只用于 join/cap/look-ahead
3. 生成最终三角形时，只让“归属该 tile 的中心线/面片”进入输出

如果后面发现复杂 line/pattern 仍需要 tile clip mask，再补一个可选 stencil path。

## Overzoom 支持

这一块建议直接参考 MapLibre 的 `vector_tile_overzoomed.ts` 思路。

### 原则

- source 有 `maxzoom`
- scene 请求的 z 更高时，不再请求更深的原始 PBF
- 从父级 tile 做 slice / scale / offset

### 好处

- 减少网络请求
- 保持和 MapLibre 一致的视觉层级
- 便于缓存

## GPU 上传与命令构建

主线程只做两件事：

1. 把 worker 产出的 typed arrays 上传到 GPU
2. 每帧根据当前活跃 tile 生成/复用 `DrawCommand`

### 建议使用的 Cesium 能力

- `Buffer.createVertexBuffer`
- `Buffer.createIndexBuffer`
- `VertexArray`
- `ShaderProgram.fromCache` / `ShaderProgram.replaceCache`
- `RenderState.fromCache`
- `DrawCommand`
- `Pass.OPAQUE` / `Pass.TRANSLUCENT`

### command 粒度

推荐：

- 一个 tile
- 一个 layer family
- 一个 segment
- 对应一个 `DrawCommand`

不要做得比这个更细。

### render state 建议

- fill opaque: `depthTest=true`，`depthMask=true`，`blending=false`
- fill translucent: `depthTest=true`，`depthMask=false`，`alpha blend`
- line/circle: 基本走 translucent pass
- pick pass: 二期再加 derived command

## 调度设计

这一块必须单独设计，不能等功能做完再补。MVT 在 Cesium 中的瓶颈通常不只是“怎么画”，而是：

- 哪些 tile 先下载
- 哪些 tile 先交给 worker
- 哪些 tile 先上传 GPU
- 哪些 tile 本帧值得出 command

如果这四级调度没有分开，镜头一动就会出现：

- 请求风暴
- worker 堵塞
- 主线程 upload 峰值卡顿
- 老 tile 还没清掉，新 tile 又堆满内存

### 建议拆成四级队列

1. 网络请求队列
2. worker 构建队列
3. GPU 上传队列
4. 渲染活跃队列

不要只维护一个“tile pending 列表”。

### 1. 网络请求队列

职责：

- 控制 PBF 下载并发
- 去重同一个 tile 的重复请求
- 支持取消低优先级请求
- 支持失败重试和退避

建议字段：

- `priority`
- `tileKey`
- `abortController`
- `attempt`
- `scheduledFrame`

建议规则：

- 同一 tile 只能有一个在途网络请求
- 相机当前视锥内 tile 优先级最高
- 当前缩放层级优先于预取层级
- 子 tile 已经进入 ready 时，父 tile 可降权
- 连续快速飞行时，超时未完成的远端 tile 可以取消

### 2. worker 构建队列

职责：

- 控制 parse / bucket build / overzoom / triangulation
- 避免所有下载完成的 tile 一次性挤爆 worker

建议规则：

- `workerCount` 建议默认 `Math.max(1, navigator.hardwareConcurrency - 2)`，同时设上限
- 同一个 tile 的旧任务结果如果晚于新版本返回，要直接丢弃
- style 变更后，旧 style version 的 worker 返回结果全部作废
- 重型任务优先级略低于视锥中心附近的轻型任务，避免单个大 tile 长时间阻塞

建议增加：

- `buildVersion`
- `styleVersion`
- `enqueueTime`
- `startTime`
- `finishTime`

### 3. GPU 上传队列

这是最容易被忽略，但最影响卡顿的一层。

如果 worker 结果一返回就立刻把所有 buffer 全上传，主线程会出现明显掉帧。所以必须有单独 upload queue。

建议规则：

- 每帧限制上传 tile 数量
- 每帧限制上传总字节数
- 优先上传当前屏幕中心附近、可立刻出图的 tile
- 超出预算的 tile 延迟到下一帧上传

建议默认预算先做成可配置：

- `maxUploadTilesPerFrame`
- `maxUploadBytesPerFrame`
- `maxCreateCommandsPerFrame`

首期即使参数是经验值，也比完全不控强很多。

### 4. 渲染活跃队列

`MvtTilesetPrimitive.update(frameState)` 每帧应该先得到一个“本帧活跃 tile 集合”，再决定：

- 哪些 tile 出 command
- 哪些 tile 只保留缓存但不出 command
- 哪些 tile 应该回收

建议活跃集合至少分三类：

- `visible-now`
- `prefetch-next`
- `cached-only`

不要把所有 `ready` tile 都直接参与 command 构建。

## Tile 优先级建议

可以给每个 tile 一个动态优先级分数：

```text
priority =
  visibleWeight +
  screenSpaceErrorWeight +
  centerDistanceWeight +
  zoomMatchWeight +
  parentReadyPenalty +
  stalePenalty
```

可以先不用特别复杂，但至少考虑下面几个因素：

- 是否在当前视锥内
- 是否与当前 zoom 更匹配
- 是否离屏幕中心更近
- 父 tile 是否已经可用
- 这个 tile 是否已经过期或 style version 已过时

### 一个简单可落地的优先级顺序

1. 当前视锥内且当前 zoom 命中的 tile
2. 当前视锥内但由父级临时代替的 tile
3. 屏幕边缘附近、即将进入视野的 tile
4. 预取 tile
5. 已经过时但尚未清理的 tile

## 帧内执行顺序建议

`MvtTilesetPrimitive.update(frameState)` 建议按下面顺序执行：

1. 收集本帧被 `requestImage` 触达的 tile
2. 根据相机状态更新可见集合和优先级
3. 推进网络请求队列
4. 推进 worker 构建队列
5. 在预算内推进 GPU 上传队列
6. 为已 ready 且本帧可见的 tile 生成/复用 `DrawCommand`
7. 回收超预算且长期未访问的 tile

注意：

- command 生成要放在 upload 之后
- 回收要放在 command 使用之后
- 任何异步完成事件都只改状态，不要在回调里直接改 commandList

## 相机变化下的调度策略

要区分三种相机状态：

### 平移/轻微缩放

- 以增量更新为主
- 保守回收旧 tile
- 优先补齐边缘新进入 tile

### 快速连续缩放

- 暂时提高父级 tile 保留时间
- 降低深层预取优先级
- 控制子级 tile 上传预算，避免缩放过程中反复上传又回收

### 飞行/大范围跳转

- 允许取消旧视野请求
- 快速清空低优先级 upload queue
- 新视野范围内优先保底父级 tile，再逐步细化

## 降级与回退策略

为了避免“空白帧”，调度层必须支持回退：

- 子 tile 未 ready 时使用父 tile
- worker 构建未完成时继续画旧版本 tile
- style 热更新过程中，优先保持旧 style 可见，再分批替换

这里的核心原则是：

- 宁可短时间画得粗一点，也不要闪空
- 宁可延迟细化，也不要让主线程在一帧内做太多上传

## GPU 上传与回收的节流建议

建议不要把“ready”直接等同于“已上传”。

更合理的状态是：

- `parsed`
- `upload-queued`
- `uploading`
- `ready`

回收时也建议分两阶段：

- 先回收 command / vertex array
- 再回收 buffer

这样可以在压力较大时更细粒度地释放资源。

## 性能指标建议

从第一版开始就记录指标，不然后面很难知道卡在哪里。

至少记录：

- `visibleTileCount`
- `requestedTileCount`
- `loadingTileCount`
- `parsingTileCount`
- `uploadQueuedTileCount`
- `readyTileCount`
- `drawCommandCount`
- `cpuCacheBytes`
- `gpuCacheBytes`
- `networkLatencyAvg`
- `workerBuildTimeAvg`
- `uploadBytesThisFrame`
- `updateTimeThisFrame`

调试面板不用一开始就做 UI，但内部统计一定要先有。

## 缓存策略

至少需要两级缓存：

### CPU Cache

缓存 worker 结果：

- typed arrays
- feature index
- style family metadata

### GPU Cache

缓存：

- vertex buffer
- index buffer
- vertex array
- shader variant key
- draw command

### 回收策略

结合以下条件：

- `lastTouchedFrame`
- `lastRenderedFrame`
- `cpuByteLength`
- `gpuByteLength`
- `maxCpuBytes`
- `maxGpuBytes`

建议默认按 LRU 回收，但为刚刚被访问的 tile 设置短暂保护窗口，避免镜头轻微移动时频繁抖动。

## 性能优化清单

### CPU

- worker 池并行构建 bucket
- style family 预编译，不在 tile 构建时反复解析
- feature filter 先过，再 load geometry
- 常量属性不要展开成每顶点 attribute
- overzoom 结果单独缓存
- 网络、worker、upload 分三级队列，不要共用一个 pending 列表
- 相机高速变化时允许取消低优先级旧请求
- 同一 tile 的过期异步结果要直接丢弃，避免主线程白做工

### 内存

- 使用 transferable 传递 typed arrays
- 顶点属性按需压缩到 `Uint8` / `Uint16` / `Float32`
- 同一个颜色占位图复用
- 及时释放 worker 中间数组
- 父 tile 与子 tile 共存时要有短暂保护窗口，但不能无限保留
- `parsed` 但长期未上传的 tile 也要纳入 CPU LRU 回收

### GPU

- shader program 按 variant key 缓存
- render state 复用 `RenderState.fromCache`
- uniformMap 尽量稳定复用，避免每帧创建新对象
- segment 级复用 `DrawCommand`
- 动态属性只用 `bufferSubData` 更新差异部分
- 每帧限制上传字节数和新建 command 数量
- 不要在 worker 回调里立即 upload，统一进入 upload queue

### 渲染调度

- 只为“本帧活跃 tile”压命令
- 透明层严格保持 style 顺序
- 非透明层可按 material/program key 局部合并
- worker 完成、tile 就绪后调用 `scene.requestRender()`
- 子 tile 未 ready 时平滑回退到父 tile，避免空白
- 大范围飞行时先保底粗层级，再细化
- command 的增删改都集中在 `primitive.update(frameState)` 中完成

### 大网格

借鉴 MapLibre 的 `SegmentVector.MAX_VERTEX_ARRAY_LENGTH` 思路：

- 默认按 16 位索引拆 segment
- 如果运行环境支持 `UNSIGNED_INT` index，再决定是否允许更大 segment
- fill/line 都要考虑 segment 切分，不然后面一定踩上限

## 建议复用的依赖

### 一期建议直接引入

- `@mapbox/vector-tile`
- `pbf`
- `earcut`
- `@mapbox/point-geometry`
- `@maplibre/maplibre-gl-style-spec`

### 二期再考虑

- `@mapbox/tiny-sdf`
- `potpack`
- `murmurhash-js`
- `kdbush`
- `quickselect`
- `tinyqueue`

### 暂时不建议一开始就引入

- `@maplibre/geojson-vt`
- `@maplibre/vt-pbf`
- `@maplibre/mlt`
- `@mapbox/jsonlint-lines-primitives`

先把 vector tile 主链路跑通，再考虑这些扩展能力。

## 里程碑与 TODO

### P0 - 基础设施

- [ ] 建立 `src/mvt` 目录结构
- [ ] 建立 `MvtImageryProvider`
- [ ] 建立 `MvtTilesetPrimitive`
- [ ] 建立 style loader / style family
- [ ] 建立 tile store / cache / key
- [ ] 建立 worker pool 与协议
- [ ] 建立 placeholder image cache
- [ ] 建立网络 / worker / upload 三段队列
- [ ] 建立 tile priority 计算与基本统计字段

### P1 - 首个可用版本

- [ ] 支持 style json 中单个 vector source
- [ ] 支持 `background`
- [ ] 支持 `fill`
- [ ] 支持 `line`
- [ ] 支持 `circle`
- [ ] 支持基础 filter
- [ ] 支持 constant/source/composite 三类属性绑定
- [ ] 支持 overzoom
- [ ] 支持 tile LRU 回收
- [ ] 支持每帧 upload budget
- [ ] 支持父 tile 回退显示

### P2 - 交互与可维护性

- [ ] 增加 feature index
- [ ] 实现 `pickFeatures`
- [ ] 增加调试开关：tile bbox、bucket stats、draw command 计数
- [ ] 增加性能统计：CPU/GPU bytes、worker 耗时、upload 耗时
- [ ] 增加队列状态统计：network / worker / upload
- [ ] 增加相机飞行场景下的取消与降级策略

### P3 - symbol

- [ ] icon atlas
- [ ] text shaping
- [ ] glyph atlas
- [ ] symbol bucket
- [ ] placement
- [ ] collision
- [ ] fade / opacity dynamic buffer

### P4 - 地形与高级样式

- [ ] 可选地形高度采样
- [ ] 贴地 line/fill 策略
- [ ] line dash / pattern / gradient
- [ ] fill pattern
- [ ] feature-state 动态更新
- [ ] 更完整 style spec 支持

## 测试建议

虽然当前阶段主要是方案文档，但真正开始实现后测试必须提前铺上。

### 单元测试

- style family 分组
- filter 结果
- overzoom slice
- fill triangulation
- large mesh segmentation
- line join/cap 几何
- tile LRU 回收
- tile 坐标到经纬度/ECEF 转换

### 集成测试

- viewer 中加载单一 style 的 smoke test
- 相机移动后 tile 生命周期是否稳定
- 连续缩放时 overzoom 是否正确
- worker 异步完成后是否能自动触发渲染

### 回归测试重点

- 高纬度 tile 精度
- tile 边缘 line/fill 是否重复或开裂
- 半透明 style 顺序
- 大瓦片高顶点量场景

## 最后给当前方案的建议落点

如果现在就开始写代码，我建议第一批只做下面这条最小闭环：

1. `MvtImageryProvider`
2. `MvtTilesetPrimitive`
3. worker 解析 PBF
4. `fill` + `line` + `circle`
5. 贴椭球体
6. overzoom
7. LRU

这一批做完，性能和架构都能验证，后面再加 symbol 和 terrain 才不会推倒重来。

## 参考源码

### MapLibre

- `vector_tile_worker_source.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/source/vector_tile_worker_source.ts
- `worker_tile.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/source/worker_tile.ts
- `fill_bucket.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/fill_bucket.ts
- `line_bucket.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/line_bucket.ts
- `circle_bucket.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/circle_bucket.ts
- `symbol_bucket.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/symbol_bucket.ts
- `program_configuration.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/program_configuration.ts
- `draw_fill.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/webgl/draw/draw_fill.ts
- `draw_line.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/webgl/draw/draw_line.ts
- `draw_circle.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/webgl/draw/draw_circle.ts
- `draw_symbol.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/webgl/draw/draw_symbol.ts
- `placement.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/placement.ts

### Cesium

- `ImageryProvider.js`
  https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/ImageryProvider.js
- `UrlTemplateImageryProvider.js`
  https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/UrlTemplateImageryProvider.js
- `DrawCommand.js`
  https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Renderer/DrawCommand.js
- `Primitive.js`
  https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/Primitive.js
- `Vector3DTilePrimitive.js`
  https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/Vector3DTilePrimitive.js
- `GroundPolylinePrimitive.js`
  https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/GroundPolylinePrimitive.js
