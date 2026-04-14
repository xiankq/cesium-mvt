# Symbol 图层实现计划

## 概述

Symbol 图层是 MapLibre 中最复杂的图层类型之一，包括文本标注和图标显示。为了快速实现并保持与 MapLibre 的兼容性，我们将采用以下策略：

## 实现策略

### 方案一：使用 Cesium 原生 API（推荐）

**优势：**

- 快速实现，无需重新实现碰撞检测
- Cesium 的 Label 和 Billboard 已经优化
- 支持文本和图标的基本功能

**劣势：**

- 碰撞检测算法与 MapLibre 不同
- 文本布局可能略有差异
- 无法完全复现 MapLibre 的行为

**实现步骤：**

1. **Phase 1: 基础结构（1-2天）**
   - [ ] 创建 SymbolBucket 数据结构
   - [ ] 实现 SymbolBucketBuilder
   - [ ] 创建 SymbolLayerStyleResolver
   - [ ] 集成到渲染管线

2. **Phase 2: 文本标注（2-3天）**
   - [ ] 解析 text-field 表达式
   - [ ] 解析 text-font、text-size 等属性
   - [ ] 使用 Cesium LabelCollection 渲染文本
   - [ ] 支持文本偏移、旋转等属性

3. **Phase 3: 图标支持（2-3天）**
   - [ ] 解析 icon-image 表达式
   - [ ] 实现 Sprite 图集加载
   - [ ] 使用 Cesium BillboardCollection 渲染图标
   - [ ] 支持图标大小、旋转等属性

4. **Phase 4: 优化和测试（1-2天）**
   - [ ] 性能优化
   - [ ] 添加测试用例
   - [ ] 修复 bug

### 方案二：完整实现 MapLibre 的 Symbol 系统（长期）

**优势：**

- 完全兼容 MapLibre 的行为
- 可以实现精确的碰撞检测
- 支持所有 MapLibre 的 Symbol 属性

**劣势：**

- 实现复杂度高
- 需要大量时间
- 需要实现字形管理、碰撞检测等复杂功能

**实现步骤：**

1. **Phase 1: 字形管理（3-5天）**
   - [ ] 实现 GlyphManager
   - [ ] 支持 CJK 字体
   - [ ] 字形缓存

2. **Phase 2: 文本布局（3-5天）**
   - [ ] 实现 Shaping
   - [ ] 支持文本换行
   - [ ] 支持文本方向

3. **Phase 3: 碰撞检测（5-7天）**
   - [ ] 实现 GridIndex
   - [ ] 实现 CollisionIndex
   - [ ] 实现 Placement

4. **Phase 4: 渲染（3-5天）**
   - [ ] 实现 SymbolBucket
   - [ ] 实现 SymbolProgram
   - [ ] 集成到渲染管线

## 当前决策

**采用方案一：使用 Cesium 原生 API**

**理由：**

1. 可以快速提供可用的 Symbol 图层
2. Cesium 的 Label 和 Billboard 已经经过优化
3. 后续可以根据需求逐步完善

## 实现细节

### 1. SymbolBucket 数据结构

```typescript
interface SymbolBucketData {
  positions: Float64Array; // 位置坐标
  featureIds: Float32Array; // 特征 ID

  // 文本相关
  texts?: string[]; // 文本内容
  textFonts?: string[]; // 字体
  textSizes?: number[]; // 字体大小
  textColors?: string[]; // 文本颜色

  // 图标相关
  iconImages?: string[]; // 图标名称
  iconSizes?: number[]; // 图标大小
}
```

### 2. SymbolLayerStyleResolver

```typescript
interface SymbolLayerStyle {
  // 文本属性
  textField?: string;
  textFont?: string;
  textSize?: number;
  textColor?: string;
  textOpacity?: number;
  textOffset?: [number, number];
  textAnchor?: 'center' | 'left' | 'right' | 'top' | 'bottom';

  // 图标属性
  iconImage?: string;
  iconSize?: number;
  iconColor?: string;
  iconOpacity?: number;
  iconOffset?: [number, number];
  iconAnchor?: 'center' | 'left' | 'right' | 'top' | 'bottom';

  // 通用属性
  symbolPlacement?: 'point' | 'line';
  symbolSpacing?: number;
  symbolAvoidEdges?: boolean;
}
```

### 3. 渲染流程

1. 解析瓦片数据，提取点要素
2. 根据 Symbol 图层样式，计算文本和图标属性
3. 创建 Cesium Label 和 Billboard
4. 添加到 LabelCollection 和 BillboardCollection
5. 管理生命周期和更新

## 测试计划

1. **单元测试**
   - SymbolBucket 数据结构
   - SymbolLayerStyleResolver 属性解析
   - 表达式求值

2. **集成测试**
   - 文本标注渲染
   - 图标渲染
   - 样式更新

3. **性能测试**
   - 大量标注的性能
   - 内存使用
   - 渲染帧率

## 风险和限制

1. **碰撞检测**
   - Cesium 的碰撞检测与 MapLibre 不同
   - 可能出现标注重叠

2. **文本布局**
   - 文本换行、方向可能与 MapLibre 有差异
   - 字体渲染可能不同

3. **Sprite 图集**
   - 需要实现 Sprite 加载和解析
   - 图标坐标计算

## 后续优化

1. 实现简单的碰撞检测（基于距离）
2. 支持文本避让
3. 优化大量标注的性能
4. 支持动态更新
