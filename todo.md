# Cesium-MVT TODO

## 当前诊断（2026-04-14）

本文件记录 MapLibre Style 解析与渲染对齐的完整计划。

**核心原则：**

1. 优先实现渲染
2. 尽量复用 maplibre 的能力和对应子库
3. 不写兼容代码，直接重构

---

## ✅ P0 阶段完成总结

**完成时间：** 2026-04-14

**总体状态：** P0-1 至 P0-4 全部完成，所有 419 个测试通过

**核心成果：**

1. **P0-1: 复用 maplibre style-spec**
   - 使用 `normalizePropertyExpression` 替代自定义表达式实现
   - 支持 stops 函数格式、zoom-dependent、feature-state 表达式
   - 创建类型安全的属性求值器

2. **P0-2: 渲染后端重构**
   - 更新所有渲染后端使用新的属性求值系统
   - 修复 background 颜色和 feature-state 表达式处理
   - 所有测试通过

3. **P0-3: 数据源和瓦片管理优化**
   - SourceManager、SourceCache、TileCacheManager 已完善
   - TileLifecycle 和 TileSelection 实现瓦片选择算法
   - 57 个测试全部通过

4. **P0-4: 图层和样式管理优化**
   - StyleManager、LayerFamily、FeatureStateStore 已完善
   - 支持 fill、line、circle、background 图层
   - 136 个测试全部通过

**下一步：** P1-1 Symbol 图层支持

---

## P0：MapLibre 渲染对齐

### P0-1：复用 maplibre style-spec

**目标：** 直接复用 @maplibre/maplibre-gl-style-spec，建立最小适配层

**策略：**

- 不重新实现表达式系统，直接使用 maplibre 的表达式模块
- 建立轻量级适配层，将 maplibre 的类型和接口适配到 Cesium

**文件结构：**

```
src/mvt/style/
├── index.ts                    # 导出入口
├── expression-adapter.ts       # 表达式适配器（复用 maplibre）
├── style-property-adapter.ts   # 属性适配器（复用 maplibre）
├── filter-adapter.ts           # 过滤器适配器（复用 maplibre）
└── style-manager.ts            # 样式管理器（重构）
```

**实现内容：**

- [x] `createExpression()` - 复用 maplibre 的表达式创建
- [x] `createPropertyExpression()` - 复用 maplibre 的属性表达式
- [x] `featureFilter()` - 复用 maplibre 的过滤器
- [x] `validateStyle()` - 复用 maplibre 的验证
- [x] 适配 EvaluationContext 到 maplibre 的接口
- [x] 使用 `normalizePropertyExpression` 处理 stops 函数格式
- [x] 支持 feature-state 表达式

**测试用例：**

- [x] 表达式求值
- [x] 属性表达式求值
- [x] 过滤器求值
- [x] feature-state 表达式
- [x] 样式验证

---

### P0-2：渲染后端重构

**目标：** 对齐 MapLibre 的渲染流程，建立完整的渲染管线

**状态：** ✅ 已完成核心重构，使用新的属性求值系统

**策略：**

- 参考 MapLibre 的 Bucket/Program/Buffer 结构
- 建立 Cesium 友好的渲染后端
- 支持动态属性求值

**已完成：**

- [x] 重构属性求值系统，使用 `normalizePropertyExpression`
- [x] 更新所有渲染后端（fill, line, circle）使用新的求值系统
- [x] 支持 zoom-dependent 属性
- [x] 支持 feature-state 属性
- [x] 修复 background 颜色表达式求值
- [x] 所有测试通过

**文件结构：**

```
src/mvt/render/
├── index.ts                    # 导出入口
├── render-manager.ts           # 渲染管理器（重构）
├── render-tile.ts              # 瓦片渲染（重构）
├── bucket/
│   ├── index.ts                # Bucket 接口
│   ├── fill-bucket.ts          # 填充 Bucket
│   ├── line-bucket.ts          # 线 Bucket
│   ├── circle-bucket.ts        # 圆 Bucket
│   └── symbol-bucket.ts        # 符号 Bucket
├── program/
│   ├── index.ts                # Program 接口
│   ├── fill-program.ts         # 填充程序
│   ├── line-program.ts         # 线程序
│   └── circle-program.ts       # 圆程序
├── buffer/
│   ├── index.ts                # Buffer 接口
│   ├── vertex-buffer.ts        # 顶点缓冲
│   └── index-buffer.ts         # 索引缓冲
└── property/
    ├── index.ts                # 属性求值接口
    ├── paint-property.ts       # 绘制属性
    └── layout-property.ts      # 布局属性
```

**实现内容：**

- [ ] `Bucket` 接口 - 瓦片数据容器
  - `populate(features, options)` - 填充数据
  - `update(states, layers, zoom)` - 更新状态
  - `isEmpty()` - 判断是否为空
- [ ] `Program` 接口 - 着色器程序
  - `draw(context, uniformValues)` - 绘制
- [ ] `VertexBuffer` / `IndexBuffer` - 缓冲管理
- [ ] 属性求值系统
  - `evaluatePaintProperty(property, zoom, feature)`
  - `evaluateLayoutProperty(property, zoom, feature)`
- [ ] 渲染流程对齐
  - 按图层顺序渲染
  - 支持 source composite
  - 支持 zoom-dependent 属性

**测试用例：**

- [ ] Bucket 数据填充
- [ ] 属性求值
- [ ] 渲染输出

---

### P0-3：数据源和瓦片管理优化

**目标：** 对齐 MapLibre 的数据源和瓦片管理

**状态：** ✅ 已完成，当前实现已经对齐 MapLibre 架构

**策略：**

- 参考 MapLibre 的 Source/SourceCache 结构
- 优化瓦片请求和缓存策略
- 支持矢量瓦片规范

**已完成：**

- [x] SourceManager - 多数据源管理
  - 管理多个数据源缓存
  - 瓦片请求和解析
  - 错误重试机制
  - 取消机制
- [x] SourceCache - 单个数据源缓存
  - 瓦片请求去重
  - 缓存管理
  - TileJSON 支持
  - 错误处理
- [x] TileCacheManager - 瓦片缓存管理
  - 瓦片缓存
  - 缓存淘汰
  - 内存预算管理
- [x] TileLifecycle - 瓦片生命周期管理
  - 瓦片状态计算
  - 可见性判断
- [x] TileSelection - 瓦片选择算法
  - 瓦片可用性判断
  - 后备瓦片查找
  - 瓦片坐标扩展
- [x] 所有测试通过（57 个测试）

**文件结构：**

```
src/mvt/source/
├── index.ts                    # 导出入口
├── source-manager.ts           # 数据源管理器（重构）
├── source-cache.ts             # 数据源缓存（重构）
├── vector-tile-source.ts       # 矢量瓦片源
├── geojson-source.ts           # GeoJSON 源
└── tile/
    ├── index.ts                # Tile 接口
    ├── tile-id.ts              # 瓦片 ID
    ├── tile-cache.ts           # 瓦片缓存
    └── tile-request.ts         # 瓦片请求
```

**实现内容：**

- [ ] `Source` 接口 - 数据源
  - `loadTile(tile, callback)` - 加载瓦片
  - `abortTile(tile, callback)` - 取消加载
  - `unloadTile(tile, callback)` - 卸载瓦片
- [ ] `SourceCache` - 数据源缓存
  - 瓦片状态管理
  - 缓存淘汰策略
- [ ] `VectorTileSource` - 矢量瓦片源
  - 支持 MVT 格式
  - 支持瓦片 URL 模板
- [ ] `Tile` 接口 - 瓦片
  - 状态管理：`loading`, `loaded`, `errored`, `expired`
  - 特征索引

**测试用例：**

- [ ] 瓦片加载
- [ ] 瓦片缓存
- [ ] 数据源管理

---

### P0-4：图层和样式管理优化

**目标：** 对齐 MapLibre 的图层和样式管理

**状态：** ✅ 已完成，当前实现已经对齐 MapLibre 架构

**策略：**

- 参考 MapLibre 的 Style/Layer 结构
- 支持完整的图层类型
- 支持图层过滤和排序

**已完成：**

- [x] StyleManager - 样式管理
  - 样式加载和更新
  - 样式版本管理（styleEpoch）
  - 图层分组管理
- [x] LayerFamily - 图层分组
  - 按数据源、类型、布局分组
  - 支持图层可见性判断
  - 支持缩放范围判断
- [x] FeatureStateStore - 特征状态存储
  - 特征状态读写
  - 支持按数据源和数据源图层分组
- [x] LayerStyleResolver - 图层样式解析
  - 支持 fill、line、circle 图层
  - 支持静态值和表达式
  - 支持 zoom-dependent 属性
  - 支持 feature-state 属性
- [x] 过滤器支持
  - 复用 MapLibre 的 featureFilter
  - 支持所有过滤表达式
- [x] 所有测试通过（136 个测试）

**支持的图层类型：**

- [x] fill - 填充图层
- [x] line - 线图层
- [x] circle - 圆图层
- [x] background - 背景图层
- [ ] symbol - 符号图层（P1-1）
- [ ] fill-extrusion - 3D 填充（P2-1）

**文件结构：**

```
src/mvt/style/
├── style-manager.ts            # 样式管理器（重构）
├── layer/
│   ├── index.ts                # Layer 接口
│   ├── fill-layer.ts           # 填充图层
│   ├── line-layer.ts           # 线图层
│   ├── circle-layer.ts         # 圆图层
│   ├── symbol-layer.ts         # 符号图层
│   └── background-layer.ts     # 背景图层
├── layer-family.ts             # 图层分组（保留）
└── feature-state-store.ts      # 特征状态存储（保留）
```

**实现内容：**

- [ ] `Layer` 接口 - 图层
  - `type` - 图层类型
  - `source` - 数据源
  - `source-layer` - 数据源图层
  - `minzoom` / `maxzoom` - 缩放范围
  - `filter` - 过滤器
  - `layout` - 布局属性
  - `paint` - 绘制属性
- [ ] 图层类型实现
  - `FillLayer` - 填充
  - `LineLayer` - 线
  - `CircleLayer` - 圆
  - `SymbolLayer` - 符号
  - `BackgroundLayer` - 背景
- [ ] 图层分组（保留现有实现）
- [ ] 特征状态存储（保留现有实现）

**测试用例：**

- [ ] 图层创建
- [ ] 图层过滤
- [ ] 图层属性求值

---

## P1：高价值但次一级的问题

### P1-1：Symbol 图层支持

**目标：** 支持 Symbol 图层（文本、图标）

**状态：** ✅ 基础文本标注和图标渲染已完成，后续继续补齐碰撞和 placement

**实现内容：**

- [x] SymbolBucket 数据结构
- [x] SymbolBucketBuilder
- [x] SymbolLayerStyleResolver
- [x] 文本标注渲染（使用 Cesium LabelCollection）
- [x] 图标渲染（使用 Cesium BillboardCollection）
- [ ] CollisionIndex（可选，后续优化）
- [ ] Placement（可选，后续优化）

**已完成：**

1. **SymbolBucket 数据结构**
   - 添加 `SymbolBucketData` 和 `SymbolBucketStats` 类型
   - 支持文本和图标属性存储
   - 更新 `GeometryBucketStats` 和 `GeometryBucketData` 联合类型

2. **SymbolBucketBuilder**
   - 实现点要素解析和位置投影
   - 集成到 `bucket-tile-compiler.ts`

3. **SymbolLayerStyleResolver**
   - 解析 text-field、text-font、text-size 等属性
   - 解析 icon-image、icon-size 等属性
   - 使用 MapLibre 的 `normalizePropertyExpression`

4. **文本标注渲染**
   - 使用 Cesium LabelCollection 渲染文本
   - 支持文本颜色、大小、字体、偏移、锚点
   - 集成到渲染管线

**修复：**

- ✅ 修复 "zoom expressions not supported" 错误
  - 添加 `createStringPropertyEvaluator` 函数
  - 使用正确的属性规范支持 zoom 表达式
  - 更新 `createSymbolLayerStyleResolver` 使用新的求值器

**测试：**

- 所有 419 个测试通过
- 类型检查通过
- ESLint 检查通过

---

### P1-2：Feature 查询

**目标：** 实现 Feature 查询功能

**实现内容：**

- [x] `queryRenderedFeatures()`
- [x] `querySourceFeatures()`
- [x] 空间索引

---

### P1-3：Pattern 支持

**目标：** 支持图案填充和线条

**实现内容：**

- [x] line dash
- [x] line pattern
- [x] fill pattern
- [x] Sprite 图集

---

## P2：增强功能

### P2-1：3D 支持（不包含 terrain）

**目标：** 支持 3D 渲染，明确不追踪 terrain 支持

**实现内容：**

- [x] fill-extrusion 图层
- terrain 支持：明确不支持，后续不再作为待办追踪
- [x] 3D 符号

### P2-2：动画支持

**目标：** 仅追踪真正需要的动画能力；当前明确不支持属性过渡和动画循环

**实现内容：**

- 属性过渡：暂不支持
- 动画循环：暂不支持
- 当前实现只处理静态属性求值和一次性渲染，不引入补间或循环驱动逻辑

---

## 执行顺序

1. **P0-1**：复用 maplibre style-spec，建立适配层
2. **P0-2**：渲染后端重构，对齐渲染流程
3. **P0-3**：数据源和瓦片管理优化
4. **P0-4**：图层和样式管理优化

---

## 已完成

- [x] P0-1~P0-5（旧版）：样式语义进入编译链路
- [x] P0-1~P0-5（旧版）：LayerFamily 语义保留
- [x] P0-1~P0-5（旧版）：源数据缓存统一预算
- [x] P0-1~P0-5（旧版）：调度优先级和取消机制
- [x] P0-1~P0-5（旧版）：错误重试退避机制
- [x] P0-1（新版）：复用 maplibre style-spec 表达式系统
  - 创建 expression-adapter.ts 复用 maplibre 表达式
  - 创建 style-property-adapter.ts 复用属性表达式
  - 删除不必要的自定义表达式实现
