# Cesium MVT

基于 Cesium 的 MVT（Mapbox Vector Tiles）矢量瓦片渲染器。

## 项目简介

本项目借鉴 MapLibre 在样式解析、瓦片生命周期、bucket 化上的成熟经验，遵循 Cesium 的瓦片调度和渲染架构，实现了一套以 Cesium 为核心的矢量瓦片渲染系统。

### 核心特性

- ✅ **基础几何渲染**：支持 fill、line、circle 三种基础几何类型
- ✅ **瓦片管理**：完整的瓦片状态机和生命周期管理（candidate → selected → shown）
- ✅ **缓存系统**：LRU 字节级缓存（默认 256MB）
- ✅ **Fallback 机制**：父瓦片降级显示，避免白洞
- ✅ **多数据源**：支持 Vector Tile Source 和 GeoJSON Source
- ✅ **Web Worker**：Worker/Inline 双模式编译
- ✅ **样式系统**：支持 MapLibre Style Specification（基础 paint 属性）

### 架构理念

- **尊重 MapLibre 设计思路**：Bucket 机制、LayerFamily 合并、Worker 通信、GeoJSON → MVT 转换
- **遵循 Cesium 架构方法**：瓦片调度、请求去重、缓存驱逐、PrimitiveCollection 集成
- **复用已有生态库**：`@mapbox/vector-tile` 解析 MVT、`@maplibre/geojson-vt` 处理 GeoJSON、`earcut` 三角剖分、Cesium `Buffer*Collection` 渲染

### 技术栈

- **Cesium** (`@cesium/engine` + `cesium`) - 3D 地球渲染引擎
- **Vue 3** - 前端框架
- **TypeScript** - 类型安全
- **MapLibre 生态** - `@maplibre/maplibre-gl-style-spec`（样式规范）、`@maplibre/geojson-vt`、`@maplibre/vt-pbf`
- **Mapbox 生态** - `@mapbox/vector-tile`（MVT 解析）、`earcut`（三角剖分）
- **Vitest** - 测试框架

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm build
```

### 运行测试

```bash
pnpm test
```

### 代码检查

```bash
pnpm lint:eslint --fix
pnpm lint:tsc
```

## 使用示例

```typescript
import { CesiumVectorTile } from './mvt/cesium-vector-tile';

// 从样式 URL 创建
const mvtLayer = await CesiumVectorTile.fromUrl(
  'https://tiles.openfreemap.org/styles/liberty',
  { scene: viewer.scene }
);

viewer.scene.primitives.add(mvtLayer);
```

## 架构概览

### 数据流

```
Cesium 帧循环
    ↓
CesiumVectorTileCoordinator (协调中心)
    ├── TileScheduler → 计算视图覆盖瓦片
    ├── TileSelection → 分类为 ready/request/fallback
    ├── SourceManager → 请求 MVT 数据
    │     ├── SourceCache (请求去重)
    │     └── BucketTileDispatcher (Worker/Inline 编译)
    │           └── BucketBuilder (Fill/Line/Circle)
    ├── TileCacheManager → LRU 缓存管理
    └── RenderManager → 挂载/显示/隐藏渲染瓦片
          └── BucketRenderedTileHandle
                ├── Fill → BufferPolygonCollection
                ├── Line → BufferPolylineCollection
                └── Circle → BufferPointCollection
```

### 核心模块

| 模块            | 职责                                          | 关键文件                                                       |
| --------------- | --------------------------------------------- | -------------------------------------------------------------- |
| **顶层集成**    | Cesium PrimitiveCollection 封装，驱动每帧调度 | `cesium-vector-tile.ts`                                        |
| **协调器**      | 串联调度/缓存/渲染/源管理                     | `cesium-vector-tile-coordinator.ts`                            |
| **数据源**      | Vector Tile / GeoJSON 请求和缓存              | `source/source-cache.ts`、`source/geojson-source-cache.ts`     |
| **调度**        | 视图瓦片选择、LOD 估算、Fallback              | `source/tile-scheduler.ts`、`source/tile-selection.ts`         |
| **Bucket 编译** | MVT → Bucket 中间表示（Worker/Inline）        | `bucket/bucket-tile-compiler.ts`、`bucket/*-bucket-builder.ts` |
| **渲染**        | Bucket → Cesium Primitive                     | `render/bucket-rendered-tile.ts`、`render/backend/*.ts`        |
| **样式**        | MapLibre Style 解析                           | `style/style-loader.ts`、`style/layer-family.ts`               |
| **几何处理**    | 坐标投影、网格细分、测地线细分                | `geometry/tile-projection.ts`、`geometry/grid-subdivision.ts`  |

### 与 Cesium/MapLibre 思路对比

| 维度            | MapLibre/Cesium       | 当前实现            | 一致性    |
| --------------- | --------------------- | ------------------- | --------- |
| **瓦片选择**    | Cesium: SSE 多LOD混合 | 单层估算            | ⚠️ 简化   |
| **请求去重**    | MapLibre: 状态机      | SourceCache 状态机  | ✅ 一致   |
| **Bucket 编译** | MapLibre: Worker 池   | 单 Worker/Inline    | ⚠️ 单实例 |
| **Fallback**    | Cesium: 祖先过渡      | 祖先瓦片显示        | ✅ 一致   |
| **缓存策略**    | Cesium: 字节级 LRU    | 自实现 LRU (256MB)  | ✅ 一致   |
| **Layer 分组**  | MapLibre: 逐 layer    | LayerFamily 合并    | ✅ 优化   |
| **渲染集成**    | Cesium: ImageryLayer  | PrimitiveCollection | ⚠️ 未复用 |

## 已实现功能

### 数据源

- [x] Vector Tile Source（URL + TileJSON 自动解析）
- [x] Vector Tile Source（内联 tiles 数组）
- [x] GeoJSON Source（URL + 内联数据）
- [x] TMS/XYZ 坐标方案自动处理

### 几何类型

- [x] **Fill**：多边形三角剖分（earcut）+ 网格细分（抗裂缝）
- [x] **Line**：测地线细分（适配地球曲率）
- [x] **Circle**：点精灵渲染

### 样式

- [x] MapLibre Style 加载（URL + 对象）
- [x] 基础 paint 属性：fill-color、fill-opacity、line-color、line-width、circle-color、circle-radius
- [x] LayerFamily 合并（相邻兼容 layer 共用 Bucket）
- [x] 样式热更新（epoch 机制防竞争）

### 调度

- [x] 视口瓦片选择
- [x] 请求去重（SourceCache 状态机）
- [x] Fallback 祖先瓦片降级
- [x] 层级映射（超 maxZoom / 低于 minZoom）
- [x] 可见性裁剪（视锥体 + 地平线检测）

### 缓存

- [x] LRU 字节级缓存（默认 256MB）
- [x] 缓存驱逐（通知渲染层清理）
- [x] 请求缓存（pending 请求复用）

### Worker

- [x] Bucket 编译 Worker
- [x] Worker/Inline 双模式
- [x] Transferable 优化
- [x] 请求取消支持

## 已知限制

### 未实现功能

| 功能                  | 说明                           | 优先级 |
| --------------------- | ------------------------------ | ------ |
| **Symbol/Text 渲染**  | 地名、道路名、POI 标注         | 🔴 P0  |
| **数据驱动样式**      | 按属性/zoom 动态变化颜色、大小 | 🔴 P0  |
| **多 LOD 混合**       | 基于屏幕空间误差的自适应 LOD   | 🟡 P1  |
| **Fill Extrusion**    | 3D 建筑渲染                    | 🟡 P1  |
| **Line Dash/Pattern** | 虚线、纹理填充                 | 🟡 P1  |
| **Feature Query**     | 点击/悬停查询                  | 🟢 P2  |

### 架构约束

- **不贴地**：明确决策，不使用 Cesium 的地形高度采样
- **Buffer\*Collection API**：项目使用 Cesium 实验性 API，其能力边界即为项目边界
- **单层 LOD**：当前整个视图使用单一层级，不支持远距离/近距离不同精度

### 性能现状

- 🔴 表达式/样式在运行时重复求值，未预编译
- 🟡 单个 Worker 实例，多核 CPU 利用率低
- 🟡 BucketBuilder 使用 number[] 中间态再转 TypedArray，内存效率低

详细性能分析和优化计划见 [todo.md](./todo.md)。

## 架构分析与优化计划

本项目已完成深度架构分析，对比了 Cesium ImageryProvider 和 MapLibre GL JS 的源码实现。

### 核心优势

- ✅ 多数据源协调机制清晰
- ✅ 瓦片状态机完整 (candidate → selected → shown)
- ✅ Fallback 机制健壮
- ✅ LRU 缓存实现合理
- ✅ LayerFamily 合并优化合理

### 已识别的改进项

| 类型        | 问题                                                                    | 优化方向                         |
| ----------- | ----------------------------------------------------------------------- | -------------------------------- |
| 🔴 架构合规 | 自实现表达式求值器（600+行），未复用 `@maplibre/maplibre-gl-style-spec` | 迁移到官方表达式系统             |
| 🔴 功能缺失 | 数据驱动样式未接入渲染链路                                              | 让 resolver 在 bucket 编译中生效 |
| 🔴 性能     | 表达式运行时重复求值                                                    | 样式预编译 + 材质缓存            |
| 🟡 性能     | 单 Worker 实例                                                          | Worker 池（4-8 实例）            |
| 🟡 性能     | number[] 中间态                                                         | TypedArray 直接写入              |
| 🟡 架构     | 单层 LOD                                                                | 多 LOD 混合（SSE 机制）          |

### 详细分析报告

完整架构分析见 [`.archive/mvt-analysis-report.md`](./.archive/mvt-analysis-report.md)。

包含：

- 与 Cesium/MapLibre 源码思路对比
- 冗余优化识别
- 性能瓶颈深度分析
- 欠缺功能清单（基于 MapLibre 源码）
- 改进建议与优先级排序

## 开发路线图

### Milestone 1: 基础可用 ✅ 已完成

- [x] 基础 Fill/Line/Circle 渲染
- [x] 瓦片状态机和生命周期
- [x] LRU 缓存管理
- [x] Fallback 机制

### Milestone 2: 架构合规（目标：消除造轮子）

- [ ] 迁移到 `@maplibre/maplibre-gl-style-spec` 表达式
- [ ] 删除自实现表达式/过滤器/求值器
- [ ] 数据驱动样式接入

### Milestone 3: 性能优化（目标：流畅渲染）

- [ ] 样式预编译 + 材质缓存
- [ ] BucketBuilder 性能优化
- [ ] Worker 池
- [ ] 多 LOD 混合

### Milestone 4: 功能完整（目标：支持完整地图）

- [ ] Symbol 文本渲染
- [ ] 碰撞检测
- [ ] Line Dash/Pattern
- [ ] Feature Query

详细路线图见 [todo.md](./todo.md)。

## 开发指南

详细开发规范请参考 [AGENTS.md](./AGENTS.md)。

### 代码质量

- **模块化设计**：source/bucket/render/style/geometry/worker 各层职责清晰
- **类型安全**：使用 TypeScript，确保类型正确性
- **测试覆盖**：核心功能有对应的测试用例

### 关键设计决策

- **复用已有生态库**：优先使用 `@mapbox/vector-tile`、`@maplibre/geojson-vt`、`earcut` 等成熟库
- **尊重 MapLibre 思路**：Bucket 机制、Worker 通信、GeoJSON → MVT 转换遵循 MapLibre 设计
- **遵循 Cesium 架构**：瓦片调度、缓存驱逐、PrimitiveCollection 集成使用 Cesium 模式

## 许可证

私有项目
