# 基于 Cesium 的 MVT 渲染实现说明

## 目标

目标是在 Cesium 中实现一条高性能、可维护、尽量复用现有能力的 MVT 渲染链路。

当前优先级：

1. 跑通真实样式、真实 PBF、真实 Cesium 可见渲染。
2. 运行时缓存、调度、资源所有权保持清晰。
3. 优先复用 `@maplibre/*`、`@mapbox/*`、Cesium 自带能力和类型。
4. 在确认 BufferCollection 成为瓶颈前，不提前下沉手写 `DrawCommand`。

## 当前实现状态

当前已经落地的能力如下：

1. 样式与资源解析
   - 支持加载 OpenFreeMap bright style
   - 支持 `source.url -> TileJSON -> tiles`
   - 支持 `sprite -> sprite.json + sprite.png`
   - sprite atlas 会解析 PNG 并加载为 HTMLImageElement，供合成渲染使用
2. MVT 解析
   - 复用 `@mapbox/vector-tile + pbf + classifyRings`
   - 按 MapLibre style family 和 filter 过滤 feature
   - parse 阶段不再因为当前 parse zoom 不可见就直接丢掉 family，避免 render zoom 变化时层缺失
   - 支持 `fill / line / circle / symbol` bucket
3. 样式求值
   - 复用 `@maplibre/maplibre-gl-style-spec`
   - 支持常见 paint/layout property expression
   - 已覆盖通用的 zoom 表达式、`text-field`、`icon-image` 等，而不再只盯 OpenFreeMap bright 的少量字段
   - `fill` 已支持 `fill-color / fill-opacity / fill-antialias / fill-outline-color / fill-translate`
   - `line` 已支持 `line-color / line-opacity / line-width / line-gap-width / line-offset / line-translate / line-dasharray / line-cap / line-join`
   - `circle` 已支持 `circle-radius / circle-color / circle-opacity / circle-stroke-* / circle-translate`
   - `fill-sort-key / line-sort-key / circle-sort-key / symbol-sort-key` 已参与每层 feature 排序
   - expression 运行时如果遇到 `null` / 类型不匹配导致的求值异常，会安全回退到 fallback，不再让单个样式属性打爆整 tile
   - filter 运行时如果遇到脏数据触发的 MapLibre 类型警告，会按"不匹配"处理，不再把 warning 直接刷到业务控制台
4. 渲染
   - `fill` -> Cesium `BufferPolygonCollection`
   - `line` -> Cesium `BufferPolylineCollection`
   - `circle` -> Cesium `BufferPointCollection`
   - `symbol text` -> Cesium `LabelCollection`
   - `symbol icon` -> Cesium `BillboardCollection`
   - `symbol icon-text-fit` -> 图标与文本合成后使用 `BillboardCollection` 渲染
   - render bundle 会按当前 render zoom 重建内部 Cesium collection，不再把 upload 时的样式永久固化
   - parent fallback 渲染时会按 child request 的 zoom 重算样式，而不是沿用 ancestor tile 自身的 z
   - `fill / line / circle / symbol` 当前都会按 layer order 抬升局部高度，减少同平面 z-fighting、透明叠色错误和点线面互相穿插
5. 调度
   - `MvtTilesetPrimitive.update(frameState)` 统一推进 load / parse / upload / render / evict
   - provider 每帧会从 Cesium 当前 globe 正在使用的 imagery tile 集中提取当前可见 MVT tile，而不是只依赖历史 `requestImage`
   - 支持加载并发限制
   - 支持每帧 parse tile 数和 parse 字节预算
   - 支持每帧上传 tile 数和上传字节预算
   - 支持 CPU / GPU 双预算和 LRU 回收
   - 支持"当前可见 tile 优先渲染，child 未 ready 时回退到 ready 父 tile / 最近已渲染 tile"的可见集驱动渲染
   - 支持 source tile 的并发去重和顺序复用缓存
   - 支持 stale tile load / parse / upload 工作取消
   - 当前可见集会先剔除已被更细子 tile 覆盖的父 tile，减少跨层级重复渲染
6. 运行时边界
   - 生产内核代码统一使用 `@cesium/engine`
   - Viewer/UI 层保留在页面侧使用 `cesium`
   - 避免在 MVT 内核和测试里引入 Cesium widgets / knockout
7. Overzoom / overscaled tile
   - display tile 和 source tile 坐标已经分离
   - 当请求级别高于 source `maxzoom` 时，会自动回退到 source ancestor tile 加载真实 PBF
   - 渲染阶段会先把 source tile 几何坐标映射到 display tile 局部坐标中，再按 display tile extent 做 clip
   - `fill / line / circle / symbol / pickFeatures` 已统一复用 display tile clip 后的几何，overscaled child 不会再把整份 source tile 内容重复画满所有子 tile
   - point/symbol 边界判定使用半开区间，尽量避免边界点在相邻 tile 双重归属
   - provider 默认会把最大可请求层级扩展到 `source.maxzoom + 6`
8. Picking 与 feature index
   - ready tile 会构建 feature index
   - `pickFeatures` 已经可以返回基于 tile 内 bounds 的命中结果
9. Worker 化 parse
   - 无 worker 环境继续走同步 parse
   - 浏览器环境优先把 vector tile parse 下沉到独立 worker
   - worker 内会复用同一份 styleSet，避免每块 tile 重复编译 style/filter
   - worker 返回错误时，主线程会自动回退到同步 parse，避免整个场景只剩占位底图
10. 关键链路日志
    - style 加载失败会打印明确错误
    - visible tile 集收集失败会打印 warning
    - load / parse / upload 失败会打印 tile 坐标、source 坐标、source url 和阶段
    - worker 回退到同步 parse 时会打印 warning
11. Symbol collision
    - 当前已支持 tile 内、跨 symbol layer 的基础碰撞裁剪
    - symbol 当前已改为按帧使用共享 collision index，能在同一帧的可见 tile 集之间做 map-space 碰撞隐藏
    - 可明显压掉重复点标注和边界邻接 tile 的重复文本

## 当前代码结构

```text
src/mvt/
  index.ts
  mvt-imagery-provider.ts
  mvt-log.ts
  mvt-types.ts
  mvt-visible-tile.ts

  mesh/
    mvt-display-feature.ts
    mvt-geometry-normalize.ts
    mvt-tile-clip.ts
    mvt-tile-mesh-builder.ts

  parse/
    mvt-vector-tile-parser.ts

  render/
    mvt-style-material.ts
    mvt-symbol-collision.ts
    mvt-symbol-composite.ts
    mvt-symbol-renderable.ts
    mvt-tile-render-bundle.ts
    mvt-tile-transform.ts
    mvt-tileset-primitive.ts

  pick/
    mvt-feature-index.ts

  style/
    mvt-filter.ts
    mvt-style-family.ts
    mvt-style-resource.ts
    mvt-style-set.ts
    mvt-style-value.ts

  tile/
    mvt-overzoom.ts
    mvt-source-tile-cache.ts
    mvt-tile.ts
    mvt-tile-cache.ts
    mvt-tile-key.ts
    mvt-tile-loader.ts
    mvt-tile-queue.ts
    mvt-tile-store.ts

  worker/
    mvt-parse-worker-client.ts
    mvt-parse-worker-types.ts
    mvt-parse-worker.ts
```

当前最关键的文件：

- `mvt-imagery-provider.ts`
- `style/mvt-style-set.ts`
- `style/mvt-style-resource.ts`
- `parse/mvt-vector-tile-parser.ts`
- `render/mvt-symbol-composite.ts`
- `render/mvt-symbol-renderable.ts`
- `render/mvt-tile-render-bundle.ts`
- `render/mvt-tileset-primitive.ts`
- `tile/mvt-tile-store.ts`

## 当前真实链路

```text
ImageryLayer
  -> MvtImageryProvider.requestImage(x, y, z)
    -> touch tile
    -> queue load
    -> 返回 1x1 占位图

Scene.primitives
  -> MvtTilesetPrimitive.update(frameState)
    -> 同步 Cesium 当前 globe imagery 可见 tile 集
    -> cancel stale work
    -> dequeue load
    -> 计算 source coordinate
    -> source cache acquire / 去重 source request
    -> 请求 PBF
    -> queue parse
    -> sync parse 或 worker parse
    -> createMvtTileRenderBundle
    -> createMvtFeatureIndex
    -> ready tile 按当前 render zoom 重建 collection
    -> update ready bundles
    -> source cache evict
    -> 按 CPU/GPU 预算回收
```

样式资源链路：

```text
style.json
  -> vector source
    -> TileJSON
      -> tiles[]
  -> sprite
    -> sprite.json
    -> sprite.png (HTMLImageElement)
```

## 当前渲染策略

### 1. 仍然优先复用 Cesium Collection，而不是手写 DrawCommand

当前阶段继续复用：

- `BufferPolygonCollection`
- `BufferPolylineCollection`
- `BufferPointCollection`
- `LabelCollection`
- `BillboardCollection`

原因：

- 已经能真实显示
- 能复用 Cesium 自带的 GPU 资源布局和 update 逻辑
- 能更快验证样式和调度问题
- 避免现在就重复实现 shader / attribute packing / texture atlas 管理

只有在下面这些点真的成为瓶颈时，才考虑继续下沉：

- draw call 太多
- Cesium Collection 无法表达目标样式
- 需要更激进的 bucket 合批
- 需要更细粒度 shader 控制

### 2. 坐标策略

当前 tile 渲染坐标策略：

- 以 tile rectangle 中心建立局部 ENU
- 如果 display tile 与 source tile 不同，先做 source->display tile 坐标映射
- source->display 后的几何必须再 clip 到当前 display tile extent
- 再把 MVT tile 坐标映射到地理坐标
- 再投影到局部 ENU
- collection 统一使用 tile `modelMatrix`
- `fill-translate / line-translate / circle-translate` 当前先在 tile 局部坐标里换算成像素位移，再进入投影
- `line-offset` 当前在 tile 平面按折线法线做近似偏移
- `line-dasharray` 当前先在 tile 局部坐标切成 dash 段，再交给 Cesium polyline collection

### 3. Render Zoom 规则

当前 render 规则：

- parse 保留 bucket，render 再根据当前请求 tile 的 zoom 判定 layer 是否可见
- render bundle 内部在 render zoom 变化时重建 collection，而不是把 upload 阶段的 zoom 固化死
- parent fallback 渲染时使用当前 child request 的 zoom
- 这条规则直接影响颜色、线宽、文字显隐、symbol 采样和 sort-key 顺序

### 4. Symbol 当前能力边界

当前已支持：

- `text-field`
- `text-field` 的 plain string / number / boolean / formatted sections 扁平化
- `text-size`
- `text-font`
- `text-anchor`
- `text-offset`
- `text-translate`
- `text-transform`
- `text-color`
- `text-opacity`
- `text-halo-color`
- `text-halo-width`
- `icon-image`
- `icon-size`
- `icon-anchor`
- `icon-offset`
- `icon-translate`
- `icon-rotate`
- `icon-rotation-alignment: viewport | map`
- `icon-opacity`
- `icon-text-fit`: 支持 `width / height / both` 三种模式，将图标和文本合成为单个图片渲染，解决三维场景中文本被图标遮挡的问题
- `icon-text-fit-padding`
- `symbol-sort-key`
- `symbol-placement: point | line`
- 线要素按 `symbol-spacing` 做近似重复采样
- 多行文本会拆成多条居中 label，能正确表现 `latin + \\n + nonlatin`
- symbol 默认关闭深度测试距离限制，减少被面/线/地表裁掉
- 可见 tile 集内共享 collision
- 跨 symbol layer 的基础碰撞裁剪

当前仍未完成：

- 真正的屏幕空间 symbol collision / placement
- 沿路径逐字排版的 line text
- `text-writing-mode`
- 更完整的 SDF icon 样式控制

### 5. icon-text-fit 合成渲染实现

当 `icon-text-fit` 不为 `none` 时，采用以下策略：

1. **收集阶段**: 遍历所有 placement groups，收集需要合成的图标和文本对
2. **缓存阶段**: 使用 WeakMap 缓存机制，以 label 为 key，避免重复创建相同的合成条目
3. **合成阶段**: 使用 Canvas 批量合成所有项目到单个精灵图中
   - 一次性绘制所有图标和文本
   - 只调用一次 `toDataURL()`，避免性能问题
4. **渲染阶段**: Billboard 使用合成图片和对应的子区域

缓存策略：

- 合成精灵图缓存存储在 `MvtStyleSet` 中，跨瓦片共享
- 使用 WeakMap 确保当 label 对象被回收时，缓存也会自动释放

## 运行时所有权与缓存规则

### 1. 运行时缓存必须跟 provider 生命周期绑定

生产代码中的可变缓存不能放在模块顶层。

缓存应挂在这些实例上：

- `MvtImageryProvider`
- `MvtStyleSet`
- `MvtTilesetPrimitive`
- `MvtTileStore`

当前缓存所有权：

- provider: style、tile store、primitive、placeholder cache
- style set: paint/layout expression cache、visible family cache、sprite atlas、composite sprite cache
- primitive: tile render bundle、feature index、source tile cache、调度状态
- tile store: tile / queue / LRU / byte budget

### 2. 禁止模块级可变运行时缓存

禁止：

- 顶层 `Map`
- 顶层 `WeakMap`
- 顶层 promise cache
- 顶层 runtime singleton

### 3. `destroy()` 必须清资源

provider 销毁时至少要清理：

- placeholder cache
- style runtime cache
- primitive 内部 render bundle
- tile store 中的 tile / queue / 预算状态

## 性能与调度规则

### 1. 调度入口固定在 primitive.update

调度由 `MvtTilesetPrimitive.update(frameState)` 统一负责。

不要把调度散落到：

- provider
- render bundle
- 样式求值工具
- 各种临时 helper

### 2. 当前至少维持四段状态

当前调度阶段：

- `loading`
- `parse-queued / parsing`
- `upload-queued / uploading`
- `ready`

### 3. 预算控制优先于"一帧传完"

当前保留这些硬限制：

- `maxConcurrentLoads`
- `maxParseBytesPerFrame`
- `maxParseTilesPerFrame`
- `maxUploadBytesPerFrame`
- `maxUploadTilesPerFrame`
- CPU / GPU 双预算
- `maxSourceCacheBytes`

### 4. 当前已做的性能优化

- style property expression 编译结果缓存到 `MvtStyleSet`
- visible family 按 zoom 缓存到 `MvtStyleSet`
- sprite atlas 只加载一次，挂在 `MvtStyleSet`
- render bundle 内部按样式值复用 Cesium material，避免同一 tile 重复创建材质对象
- render bundle 只在 render zoom 变化时重建内部 collection，平移和同级重绘不会重复组装
- `symbol` 当前改成"静态创建 Cesium `LabelCollection` / `BillboardCollection`，按帧只更新 placement/show 状态"，不再每帧销毁重建文本和图标 collection
- MVT 内核统一改用 `@cesium/engine`，避免把 widgets 包拖进内核和测试
- 相同 source tile 的并发请求会在 primitive 内去重
- source tile 原始 PBF 会按 LRU 方式缓存在 primitive 内，overzoom sibling 可顺序复用
- 单个 upload 周期内，feature index 和 render bundle 会共享一份 `displayFeatureCache`，避免同一 feature 的 source->display 映射与 clip 重复计算
- parse 不再在网络 promise 回调里立即执行，而是进入 parse queue，由 `update(frameState)` 按预算推进
- 浏览器环境下 parse 会优先放进 worker，主线程只接收解析结果并继续 upload
- worker 内部会复用 styleSet，减少重复 style/filter 编译和重复 warning history 重置
- worker parse 返回 error 时会自动回退到主线程同步 parse，优先保证能显示
- stale tile 的 load / parse / upload 会在视图切换后主动取消，避免飞行时继续吃主线程和网络
- provider 默认允许 `source.maxzoom + 6` 的 overzoom 请求窗口
- provider 每帧会从 Cesium `globe._surface.tileProvider._tilesToRenderByTextureCount` 中提取当前真正可见的 imagery tile，并持续 touch 对应 MVT tile
- primitive 优先只更新当前可见 tile 集，child 未 ready 时用 ready 父 tile 回退；当前可见 tile 都还没 ready 时，再短暂回退到最近已渲染 tile
- 当前可见集会先剔除已被更细请求子 tile 覆盖的父 tile，减少 parent/child 同时渲染导致的重复
- symbol render bundle 会做一层基础 collision，压掉 tile 内重复标注
- symbol 若当前瓦片没有生成任何文本/图标，或当前帧全部被 collision 隐藏，会按 layer 维度打印一次 warning，便于排查"样式有数据但没画出来"
- line / fill / circle 的位移、offset、dash 都先在 tile 局部空间预处理，再进入 Cesium collection
- 不支持或只能近似渲染的 layer property 会按 layer/property 维度打印一次 warning，避免控制台刷屏
- `icon-text-fit` 合成精灵图采用批量合成策略，所有需要合成的图标和文本一次性绘制到单个 Canvas 中，减少 Canvas 创建和 `toDataURL()` 调用次数
- 合成精灵图缓存使用 WeakMap 机制，跨瓦片共享缓存，避免重复创建相同的合成图片

### 5. 当前还缺的调度能力

- render bundle 中更多可序列化预处理继续下沉到 worker
- 更细粒度的 frame budget 统计

## MVT 数据规则

当前实现和后续实现都必须遵守：

1. `extent` 不能写死成 `4096`
2. MVT 坐标是 tile 局部坐标，左上原点，`y` 向下
3. 几何允许超出 tile 边界，buffer 不是异常
4. 真正进入渲染、symbol anchor 和 pick 之前，必须先把几何裁到当前 display tile，而不是直接拿 source tile buffer 几何去画
5. overzoom sibling 不能共享"整份 source tile 几何直接渲染"的结果，必须按 child display tile 单独裁剪
6. 点和 symbol 的 tile 归属尽量使用半开区间，避免边界重复
7. polygon 必须正确处理 ring / hole / 退化 ring
8. feature 属性不要过早字符串化
9. style layer 顺序必须尽量保持
10. `feature.id` 是可选的，后续 `feature-state` / pick 不能假定一定存在

## 当前编码规则

### 1. 先复用现有能力

优先复用：

- `@maplibre/maplibre-gl-style-spec`
- `@mapbox/vector-tile`
- `pbf`
- `classifyRings`
- `earcut`
- Cesium Collection / Resource / Matrix / TilingScheme / Rectangle / Billboard / Label

### 2. 不增加无意义桥接层

新增文件必须满足：

- 有明确职责边界
- 能明显降低现有复杂度
- 不是为了"看起来更分层"

### 3. `requestImage` 只做入口接入

`requestImage` 只负责：

- touch tile
- 推进请求状态
- 返回占位图

当前真正的 render 可见集由 primitive 每帧从 Cesium globe 当前 imagery tile 收集，不再把"历史 requestImage 发生过"当成"当前还在屏幕里"。

不要在里面做：

- GPU 资源创建
- render bundle 组装
- 复杂样式求值

### 4. MVT 内核优先依赖 `@cesium/engine`

规则：

- `src/mvt/**` 和 `tests/**` 优先使用 `@cesium/engine`
- Viewer/UI 层再使用 `cesium`

这样可以避免把 widgets / knockout 带进内核代码和测试环境。

## 当前未完成但明确要做的事

### P0.5

- [ ] 继续把 render bundle 中可序列化的预处理下沉到 worker

### P1

- [ ] feature index 从 bounds 命中升级到更精细几何命中
- [ ] symbol collision / placement 升级到屏幕空间和跨 tile
- [ ] line text 更完整排版
- [ ] 更细的性能统计

### P2

- [ ] fill pattern
- [ ] line pattern / gradient
- [ ] terrain follow
- [ ] feature-state
- [ ] 更完整的 style spec

### P3

- [ ] 评估是否下沉到完全自定义 `DrawCommand`

## 当前验证状态

当前已通过：

- `pnpm lint:eslint --fix .`
- `pnpm lint:tsc`
- `pnpm test`

当前测试覆盖重点：

- OpenFreeMap bright style 加载
- TileJSON / sprite atlas 解析
- vector tile parser
- 通用 style rule 解析
- render zoom 变化时 render bundle 重建
- parse worker fallback / 同步路径
- render bundle 构建
- feature index 与 pickFeatures
- display tile clip 与 overscaled 边界归属
- symbol text / icon 渲染
- symbol icon-text-fit 合成渲染
- 多行 symbol 文本解析与居中排布
- symbol collision 去重
- 邻接 tile 的共享 symbol collision
- style material 求值与材质复用
- overzoom 坐标映射与 source tile 请求去重
- source tile cache 的并发去重、顺序复用和预算回收
- tile loader
- visible tile 收集
- tileset primitive 状态推进、可见集驱动渲染、parent fallback、stale cancel

## 一句话结论

当前代码已经不是"方案阶段"，而是：

- 真实样式已接通
- 真实 MVT 数据已接通
- `fill / line / circle / symbol(text+icon)` 已可渲染
- `icon-text-fit` 支持图标与文本合成渲染
- 渲染可见集已经切到 Cesium 当前 globe imagery tile，而不是靠历史请求猜测
- 调度、缓存、资源边界已经基本理顺

接下来最值得继续投入的方向，不是再写更多抽象，而是：

1. worker 化。
2. render bundle 中更多可序列化预处理继续下沉到 worker。
3. symbol collision 升级到真正的屏幕空间 / 跨 tile 版本。
4. 只有在确实需要时，再下沉自定义 `DrawCommand`。
