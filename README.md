# Cesium MVT

基于 Cesium 的 MVT（Mapbox Vector Tiles）矢量瓦片渲染器。

## 项目简介

本项目借鉴 MapLibre 在样式解析、瓦片生命周期、bucket 化、符号布局、碰撞检测、跨瓦片稳定性、缓存与增量更新上的成熟经验，实现了一套以 Cesium 为核心的矢量瓦片渲染系统。

### 核心特性

- ✅ **基础几何渲染**：支持 fill、line、circle 三种基础几何类型
- ✅ **样式系统**：支持 MapLibre Style Specification
- ✅ **瓦片管理**：完整的瓦片状态机和生命周期管理
- ✅ **缓存系统**：LRU 缓存和动态缓存容量计算
- ✅ **Fallback 机制**：父瓦片降级显示，避免白洞
- ✅ **GeoJSON 支持**：支持 GeoJSON 数据源
- ✅ **Web Worker**：使用 Worker 进行瓦片解析，不阻塞主线程

### 技术栈

- **Cesium** - 3D 地球可视化引擎
- **Vue 3** - 前端框架
- **TypeScript** - 类型安全
- **MapLibre Style Spec** - 样式规范
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
import { StyleImageryProvider } from './mvt/imagery-provider';

const provider = await StyleImageryProvider.fromUrl(
  'https://tiles.openfreemap.org/styles/liberty',
  { scene: viewer.scene }
);

viewer.imageryLayers.addImageryProvider(provider);
```

## 项目结构

```
src/mvt/
├── cache/              # 缓存系统
│   └── tile-cache.ts       # LRU 缓存实现
├── render/             # 渲染相关
│   ├── backend/            # 渲染后端（fill/line/circle）
│   │   ├── bucket-circle-backend.ts
│   │   ├── bucket-fill-backend.ts
│   │   ├── bucket-line-backend.ts
│   │   └── material-cache.ts
│   ├── bucket-rendered-tile.ts
│   ├── feature-tile.ts
│   ├── render-order.ts
│   └── render-tile.ts
├── source/             # 数据源管理
│   ├── geojson-source-cache.ts
│   ├── source-cache.ts
│   ├── tile-manager.ts
│   ├── tile-request.ts
│   └── vector-tile.ts
├── style/              # 样式处理
│   ├── layer-family.ts
│   ├── layer-visibility.ts
│   ├── style-loader.ts
│   └── style-set.ts
├── utils/              # 工具函数
│   ├── abort.ts
│   └── clone.ts
├── worker/             # Web Worker 相关
│   ├── bucket/
│   ├── geometry/
│   ├── bucket-tile-compiler.ts
│   ├── bucket-tile-dispatcher.ts
│   ├── bucket-tile.worker.ts
│   ├── feature-tile-dispatcher.ts
│   └── feature-tile.worker.ts
├── imagery-provider.ts # ImageryProvider 门面
├── scene-layer.ts      # 场景图层核心
├── tile-selection.ts   # 瓦片选择逻辑
└── view-state.ts       # 视图状态
```

## 核心概念

### 瓦片状态机

项目实现了显式的瓦片状态管理：

- **candidate**: 进入当前帧遍历范围的瓦片
- **selected**: 当前帧希望用于渲染的瓦片
- **shown**: 当前帧真正提交了渲染命令的瓦片
- **touched**: 当前帧被使用过或保活的瓦片

### Fallback 机制

当目标瓦片未就绪时，系统会自动查找父瓦片作为降级显示，确保不会出现白洞。

### 缓存管理

- **动态缓存容量**：根据视口大小动态计算
- **LRU 淘汰**：基于最近使用时间淘汰
- **内存预算**：按字节大小控制缓存总量

## 已知限制

当前使用 Cesium 的 `Buffer*Collection` API（实验性），存在以下限制：

- 不支持贴地
- 不支持背面剔除控制
- Material API 有限

## 开发指南

详细开发规范请参考 [AGENTS.md](./AGENTS.md)。

## 许可证

私有项目
