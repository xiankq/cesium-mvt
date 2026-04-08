# MVT 代码优化任务清单

## ✅ 已完成任务

### 高优先级

- [x] **创建共享工具文件结构 src/mvt/utils/**
  - 创建了 `mvt-frame-state.ts` - FrameState 相关工具
  - 创建了 `mvt-point-utils.ts` - Point 操作工具
  - 创建了 `mvt-geometry-utils.ts` - 几何计算工具
  - 创建了 `mvt-math-utils.ts` - 数学计算工具

- [x] **提取 canUpdateCesiumCollections 到 mvt-frame-state.ts**
  - 从 `mvt-tile-render-bundle.ts` 和 `mvt-symbol-renderable.ts` 中删除重复定义
  - 统一导入到共享工具文件

- [x] **提取 Point 相关函数到 mvt-point-utils.ts**
  - `createPoint` - 创建 Point 对象
  - `clonePoint` - 克隆 Point 对象
  - `clonePoints` - 克隆 Point 数组
  - `arePointsEqual` - 比较两点是否相等

- [x] **提取几何计算函数到 mvt-geometry-utils.ts**
  - `interpolatePoint` - 点插值
  - `interpolateHorizontalIntersection` - 水平交点计算
  - `interpolateVerticalIntersection` - 垂直交点计算
  - `distanceBetweenPoints` - 两点距离计算

- [x] **使用 kdbush 优化 MvtSymbolCollisionIndex 碰撞检测**
  - 重构 `mvt-symbol-collision.ts`
  - 使用空间索引优化碰撞检测性能（从 O(n) 到 O(log n)）

- [x] **统一使用 stableStringify 替代 JSON.stringify**
  - 修改 `mvt-parse-worker.ts`
  - 确保样式键生成的一致性

### 中优先级

- [x] **拆分 mvt-symbol-renderable.ts 大文件**
  - 创建 `mvt-symbol-types.ts` - 类型定义
  - 创建 `mvt-symbol-anchor.ts` - 锚点计算
  - 创建 `mvt-symbol-icon.ts` - 图标解析
  - 创建 `mvt-symbol-label.ts` - 标签解析
  - 创建 `mvt-symbol-utils.ts` - 共享工具函数
  - 主文件从 1096 行减少到约 360 行

- [x] **为共享工具函数添加单元测试**
  - `tests/mvt-point-utils.test.ts`
  - `tests/mvt-geometry-utils.test.ts`
  - `tests/mvt-math-utils.test.ts`

- [x] **补充缺失的模块级和函数级注释**
  - 为所有工具文件添加了完整的 JSDoc 注释

### 低优先级

- [x] **提取魔法数字为常量**
  - 创建 `mvt-constants.ts` 常量文件
  - 提取 `TILE_PIXEL_SIZE`、`ICON_BYTE_SIZE`、`LAYER_HEIGHT_STEP` 等常量

## � 优化效果总结

### 代码重复消除

- 删除了 **3 个重复的函数定义**
- 统一了 **Point 操作接口**
- 统一了 **几何计算函数**

### 性能优化

- 碰撞检测从 `O(n)` 优化到 `O(log n)`
- 样式键生成更稳定，避免缓存失效

### 代码组织

- 创建了统一的工具文件结构
- 拆分大文件提高可维护性
- 提高了代码可测试性

### 文件结构

```
src/mvt/
├── utils/                      # 新增工具目录
│   ├── mvt-frame-state.ts      # FrameState 工具
│   ├── mvt-point-utils.ts      # Point 操作工具
│   ├── mvt-geometry-utils.ts   # 几何计算工具
│   └── mvt-math-utils.ts       # 数学计算工具
├── render/
│   ├── mvt-constants.ts        # 新增常量文件
│   ├── mvt-symbol-types.ts     # 新增类型定义
│   ├── mvt-symbol-anchor.ts    # 新增锚点计算
│   ├── mvt-symbol-icon.ts      # 新增图标解析
│   ├── mvt-symbol-label.ts     # 新增标签解析
│   ├── mvt-symbol-utils.ts     # 新增共享工具
│   └── mvt-symbol-renderable.ts # 重构后的主文件
```

### 测试覆盖

```
tests/
├── mvt-point-utils.test.ts     # Point 工具测试
├── mvt-geometry-utils.test.ts  # 几何工具测试
└── mvt-math-utils.test.ts      # 数学工具测试
```
