# Cesium MVT

一个基于 Cesium 的实验性 MVT 渲染项目。实现上大量参考了 MapLibre GL JS 的相关代码和设计，当前实现依赖 Cesium `1.140.0` 中 `Buffer*Collection` 相关能力。

## 现在能做什么

- 加载并渲染常见的 MVT 和 GeoJSON 场景
- 支持基础查询和样式刷新
- 仍处于实验阶段，后续会继续收敛边界和行为

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

> 注意：在测试/开发环境中，受 Vite 对 worker 的处理方式影响，页面可能会出现明显卡顿；涉及性能观感和交互流畅度的判断，请以生产打包后的结果为准。

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
import { CesiumVectorTile } from '@/mvt/cesium-vector-tile';

const layer = await CesiumVectorTile.fromUrl(
  'https://tiles.openfreemap.org/styles/liberty',
);

viewer.scene.primitives.add(layer);
```

## 开发说明

- 详细改造路线见 [todo.md](./todo.md)
- 开发规范见 [AGENTS.md](./AGENTS.md)
- 这是一个实验性实现，不承诺稳定 API

## 许可证

[MIT](./LICENSE)
