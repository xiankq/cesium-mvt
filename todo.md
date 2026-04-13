# Cesium-MVT 待办事项清单

## 一、严重缺陷（必须修复）

### 1.1 表达式求值系统（最高优先级）✅ 已完成

**问题**：当前只支持静态样式值，无法处理 MapLibre 表达式

**位置**：`src/mvt/render/backend/material-cache.ts`

**已实现**：

- [x] 表达式解析器：解析 MapLibre 表达式 AST
- [x] 表达式求值器：在运行时求值
- [x] 属性绑定：支持 feature 属性访问 `["get", "property_name"]`
- [x] Zoom 函数：支持 zoom 级别相关表达式
- [x] 插值器：支持 `interpolate` 表达式
- [x] 条件表达式：支持 `case`、`match` 表达式
- [x] 数学运算：支持 `+`、`-`、`*`、`/` 等运算
- [x] 字符串操作：支持 `concat`、`downcase`、`upcase` 等

**新增文件**：

- `src/mvt/style/expression-evaluator.ts` - 表达式求值器
- `src/mvt/style/style-property-evaluator.ts` - 样式属性求值器
- `src/mvt/style/layer-style-resolver.ts` - 图层样式解析器
- `tests/mvt/style/expression-evaluator.test.ts` - 表达式求值测试
- `tests/mvt/style/style-property-evaluator.test.ts` - 样式属性求值测试
- `tests/mvt/style/layer-style-resolver.test.ts` - 图层样式解析测试

---

### 1.2 Feature Filter 实现（高优先级）✅ 已完成

**问题**：当前直接遍历所有特征，没有应用图层过滤器

**位置**：`src/mvt/bucket/bucket-tile-compiler.ts`

**已实现**：

- [x] Filter 解析器：解析 layer.filter 表达式
- [x] Filter 求值器：对每个 feature 应用 filter
- [x] 在 `compileGeometryBatch` 中应用 filter
- [x] 添加 filter 相关测试用例

**新增文件**：

- `src/mvt/style/feature-filter.ts` - Feature 过滤器
- `tests/mvt/style/feature-filter.test.ts` - Feature 过滤器测试

---

### 1.3 Symbol 图层渲染（核心功能）

**问题**：Symbol 图层完全未实现，无法显示地名、道路名等

**位置**：需要新建 `src/mvt/render/backend/bucket-symbol-backend.ts`

**需要实现**：

- [ ] 字形管理器（Glyph Manager）
  - [ ] 从字体服务加载字形
  - [ ] 构建 SDF 字形图集
  - [ ] 缓存字形数据
  - [ ] 支持 CJK 字体
- [ ] 精灵管理器（Sprite Manager）
  - [ ] 加载精灵图集
  - [ ] 解析精灵元数据
  - [ ] 提供图标坐标
- [ ] 文本布局（Text Layout）
  - [ ] 文本整形（Shaping）
  - [ ] 文本定位
  - [ ] 文本锚点计算
  - [ ] 文本换行
- [ ] 碰撞检测（Collision Detection）
  - [ ] 网格索引
  - [ ] 碰撞框计算
  - [ ] 优先级排序
  - [ ] 跨瓦片符号稳定性
- [ ] 渲染后端
  - [ ] 文本 DrawCommand
  - [ ] 图标 DrawCommand
  - [ ] 与 Cesium 的集成

**参考**：

- `maplibre-gl-js/src/symbol/`
- `maplibre-gl-js/src/render/draw_symbol.js`

**影响**：地名、道路名、POI 标注等核心地图元素无法显示

---

## 二、中等缺陷（影响功能完整性）

### 2.1 缓存管理系统

**问题**：缓存管理不完整，缺少动态调整和统计

**位置**：`src/mvt/source/tile-cache-manager.ts`

**需要实现**：

- [ ] 内存预算动态调整
- [ ] trim 触发机制
- [ ] 缓存命中率统计
- [ ] 按优先级预取
- [ ] 缓存淘汰策略优化

---

### 2.2 请求调度器 ✅ 已完成

**问题**：缺少请求调度器，无法控制并发和优先级

**已实现**：

- [x] 集成 Cesium 的 RequestScheduler
- [x] 使用 Resource.fetchArrayBuffer 进行请求
- [x] 支持优先级调度
- [x] 支持服务器节流

**新增文件**：

- `src/mvt/source/request-scheduler.ts` - 请求调度器
- `tests/mvt/source/request-scheduler.test.ts` - 请求调度器测试

---

### 2.3 Feature Index 完善

**问题**：Feature Index 功能不完整

**位置**：`src/mvt/bucket/bucket-types.ts`

**需要实现**：

- [ ] 空间索引（R-tree 或网格索引）
- [ ] Pick 功能：屏幕坐标到 Feature
- [ ] `queryRenderedFeatures` API
- [ ] Feature 高亮功能

---

### 2.4 瓦片边界处理优化

**问题**：网格细分算法存在潜在裂缝问题

**位置**：`src/mvt/geometry/grid-subdivision.ts`

**需要修复**：

- [ ] 高缩放级别粒度优化
- [ ] 相邻瓦片边界对齐验证
- [ ] Degenerate 三角形处理
- [ ] 添加边界裂缝测试

---

## 三、轻微缺陷（优化项）

### 3.1 样式热更新

**问题**：样式更新是全量替换，没有 diff 算法

**位置**：`src/mvt/style/style-manager.ts`

**需要实现**：

- [ ] Style diff 算法
- [ ] Paint 属性增量更新
- [ ] Layout 变更检测
- [ ] Source 变更处理

**参考**：

- `maplibre-gl-js/src/style/style_diff.js`

---

### 3.2 GeoJSON 源性能优化

**问题**：大 GeoJSON 文件重复编码

**位置**：`src/mvt/source/geojson-source-cache.ts`

**需要优化**：

- [ ] 缓存编码结果
- [ ] 增量更新支持
- [ ] 大文件分块处理

---

### 3.3 高度偏移策略优化

**问题**：固定高度偏移可能导致 Z-fighting

**位置**：`src/mvt/bucket/line-bucket-builder.ts`, `circle-bucket-builder.ts`

**需要优化**：

- [ ] 动态偏移（基于相机距离）
- [ ] 深度偏移配置

---

### 3.4 瓦片选择算法优化

**问题**：没有考虑相机高度和地形

**位置**：`src/mvt/source/view-state.ts`

**需要优化**：

- [ ] 参考 Cesium 的 `QuadtreePrimitive` 实现
- [ ] 使用相机高度和视角计算

---

## 四、新功能开发

### 4.1 复杂样式支持

**优先级**：中

**需要实现**：

- [ ] Line Dash 支持
  - [ ] Line Atlas 实现
  - [ ] Dash pattern shader
- [ ] Fill Pattern 支持
  - [ ] Pattern Manager
  - [ ] Pattern shader
- [ ] Fill Extrusion 支持
  - [ ] 3D 建筑渲染
  - [ ] 高度属性解析

---

### 4.2 交互功能

**优先级**：中

**需要实现**：

- [ ] Feature 悬停高亮
- [ ] Feature 点击事件
- [ ] Feature 选择状态
- [ ] Popup 支持

---

### 4.3 性能优化

**优先级**：低

**需要实现**：

- [ ] 性能监控面板
- [ ] Debug 可视化
- [ ] 内存使用统计
- [ ] 帧率监控

---

## 五、架构改进

### 5.1 Buffer\*Collection API 评估

**问题**：当前使用的实验性 API 存在限制

**限制**：

- Material API 有限
- API 不稳定

**需要评估**：

- [ ] 是否需要自定义 DrawCommand
- [ ] 长期技术路线规划

---

### 5.2 几何细分策略改进

**问题**：细分时机和精度可能存在问题

**需要改进**：

- [ ] 考虑在投影后使用弦误差细分
- [ ] 实现屏幕空间误差估算
- [ ] 添加边界对齐验证测试

---

## 六、测试补充

### 6.1 单元测试 ✅ 已完成

**已补充**：

- [x] 表达式求值测试
- [x] Filter 功能测试
- [x] 请求调度器测试

**需要补充**：

- [ ] Symbol 布局测试
- [ ] 碰撞检测测试
- [ ] 缓存淘汰测试

---

### 6.2 集成测试

**需要补充**：

- [ ] 样式热切换测试
- [ ] 多源数据测试
- [ ] 大数据量性能测试
- [ ] 内存泄漏测试

---

### 6.3 手工验证

**需要验证**：

- [ ] 连续平移 5 分钟看内存是否稳定
- [ ] 高频缩放看 label 是否闪烁
- [ ] 切换 style 看是否发生全量闪断
- [ ] 打开 debug overlay 看 cache hit/miss 是否符合预期

---

## 七、文档完善

### 7.1 API 文档

**需要补充**：

- [ ] 公共 API 文档
- [ ] 配置选项说明
- [ ] 事件文档
- [ ] 示例代码

---

### 7.2 架构文档

**需要补充**：

- [ ] 整体架构说明
- [ ] 数据流图
- [ ] 状态机文档
- [ ] 性能优化指南

---

## 八、优先级排序

### P0 - 必须实现（已完成）

1. ✅ 表达式求值系统
2. ✅ Feature Filter
3. ✅ 基本请求调度

### P1 - 重要功能（1-2 月）

4. Symbol 文本渲染
5. 碰撞检测
6. Feature 查询

### P2 - 完善功能（3-6 月）

7. 样式热更新
8. Dash Line
9. Fill Pattern
10. Fill Extrusion

### P3 - 优化项（长期）

11. 性能优化
12. 架构改进

---

## 九、技术债务

### 9.1 代码质量

- [ ] 添加更多代码注释
- [ ] 统一错误处理
- [ ] 添加日志系统
- [ ] 代码覆盖率提升

### 9.2 类型安全

- [ ] 完善 TypeScript 类型定义
- [ ] 消除 any 类型
- [ ] 添加类型守卫

---

## 十、里程碑规划

### Milestone 1: 基础可用 ✅ 已完成

- [x] 表达式求值系统
- [x] Feature Filter
- [x] 请求调度优化

### Milestone 2: 功能完整（目标：支持完整样式）

- [ ] Symbol 渲染
- [ ] 碰撞检测
- [ ] Feature 查询
- [ ] 交互功能

### Milestone 3: 生产就绪（目标：性能和稳定性）

- [ ] 性能优化
- [ ] 内存管理
- [ ] 错误处理
- [ ] 文档完善

### Milestone 4: 高级功能（目标：支持复杂场景）

- [ ] 复杂样式
- [ ] 3D 功能
- [ ] 插件系统
