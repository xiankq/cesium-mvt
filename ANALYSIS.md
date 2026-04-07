# Cesium-MVT 问题评估与优化路线图

## 说明

本文档基于对整个 MVT 模块（33 个 TypeScript 文件）的深度代码审查整理而成。

当前分支已包含的关键修复：

- Symbol 采用 diff/reconcile 刷新，不再全量 `clear()`
- 可见 tile 集已加入父子层级 cover 归一化
- `Viewer` 已使用按需渲染模式
- line / circle 在 paint-only zoom 变化下支持原地更新
- Worker 池并行解码（`VectorTileWorkerClient` 支持多 Worker）
- 请求可取消（`AbortController` + 协议支持）
- 坐标转换预计算（`TileTransformContext`）
- 失败退避机制（指数退避，最大 4s）
- 构造异常清理（`MvtImageryProvider` try/catch 回滚）

---

## 一、P0 缺陷（严重）

### 1. TileCache.trim() 性能问题

| 维度       | 详情                                                                  |
| ---------- | --------------------------------------------------------------------- |
| **位置**   | `src/mvt/scheduler/cache.ts:51-64`                                    |
| **问题**   | 每次 `set()` 都调用 `Array.from(this.entries.entries())` 创建全量快照 |
| **影响**   | 192+ 容量下频繁调度时产生大量临时数组，高瓦片吞吐场景 GC 压力大       |
| **方案**   | 改用迭代器遍历或维护双向链表实现 O(1) 淘汰                            |
| **优先级** | P0                                                                    |

---

## 二、P1 缺陷（重要）

### 2. 瓦片排序 LIFO 导致关键瓦片饥饿

| 维度       | 详情                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| **位置**   | `src/mvt/scheduler/scheduler.ts:37-41`                                      |
| **问题**   | `sequence` 比较是后进先出（LIFO），最新请求优先于旧请求                     |
| **影响**   | 快速平移时，视口边缘的新瓦片先解码，视口中心的关键瓦片反而排队              |
| **方案**   | 改为 FIFO（`left.sequence - right.sequence`）或基于视口中心的距离加权优先级 |
| **优先级** | P1                                                                          |

### 3. Symbol 碰撞/去重索引每帧重建

| 维度       | 详情                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| **位置**   | `src/mvt/render/symbol.ts:359-361`                                                    |
| **问题**   | `rebuild()` 每帧 `new ScreenLabelCollisionIndex()` 和 `new ScreenSymbolDedupeIndex()` |
| **影响**   | 60fps 下每秒创建 120 个空间索引对象，且静止相机状态下碰撞结果与上一帧相同却未复用     |
| **方案**   | 缓存上一帧碰撞索引，相机未显著移动时复用，仅增量更新                                  |
| **优先级** | P1                                                                                    |

### 4. TextSpriteAtlas measure/resolveImage 双路径不一致

| 维度       | 详情                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| **位置**   | `src/mvt/render/text.ts:441-469`                                                                         |
| **问题**   | `measure()` 调用 `getBucket()` 触发 trim，但此时 bucket 无 entries，可能错误驱逐有 entries 的其他 bucket |
| **影响**   | 高频 label 场景下，上一帧刚渲染好的 label canvas 被驱逐，导致标签闪烁                                    |
| **方案**   | 将 trim 逻辑延迟到 `resolveImage()` 或 `setBucketEntry()` 统一执行                                       |
| **优先级** | P1                                                                                                       |

### 5. wrapSymbolText 中文字符宽度不适配

| 维度       | 详情                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| **位置**   | `src/mvt/render/label.ts:214-257`                                            |
| **问题**   | 按字符数截断（`chunk.length >= maxChars`），未考虑 CJK 字符宽度约为英文 2 倍 |
| **影响**   | 中文字串实际像素宽度可能远超 `maxWidthEm`，导致 label 溢出                   |
| **方案**   | 引入字符宽度因子，CJK 字符按 2x 计权                                         |
| **优先级** | P1                                                                           |

### 6. buildTileUrl 自定义标签无异常保护

| 维度       | 详情                                                          |
| ---------- | ------------------------------------------------------------- |
| **位置**   | `src/mvt/request/template.ts:74-77`                           |
| **问题**   | `customTags` 回调抛异常时，整个调度链路中断                   |
| **影响**   | 用户自定义标签函数出错导致瓦片无法加载                        |
| **方案**   | try/catch 包裹，失败时 fallback 到原始 token 字符串并输出警告 |
| **优先级** | P1                                                            |

### 7. estimateSceneZoom 不考虑地形和 3D Tiles

| 维度       | 详情                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| **位置**   | `src/mvt/render/geometry.ts:263-289`                                          |
| **问题**   | 使用 `cartographic.height`（椭球高）而非到实际地表的距离                      |
| **影响**   | 加载地形/建筑时，zoom 估算在山区/城市峡谷严重偏差                             |
| **方案**   | 可选接入 `sampleTerrainMostDetailed` 获取真实地表高度，或提供手动 offset 参数 |
| **优先级** | P1                                                                            |

---

## 三、P2 缺陷（次要）

### 8. normalizeVisibleTileCover 极端 zoom 下内存爆炸

| 维度       | 详情                                                            |
| ---------- | --------------------------------------------------------------- |
| **位置**   | `src/mvt/scheduler/source.ts:497-570`                           |
| **问题**   | 每帧构建完整四叉树，1000 visible tiles → 1300+ 节点 → ~260KB/帧 |
| **影响**   | 移动设备上 GC 压力显著                                          |
| **方案**   | 对象池复用节点，或改用扁平化算法                                |
| **优先级** | P2                                                              |

### 9. Line/Polygon 跨瓦片边界不连续

| 维度       | 详情                                                 |
| ---------- | ---------------------------------------------------- |
| **位置**   | `src/mvt/render/line-string.ts`, `render/polygon.ts` |
| **问题**   | 各瓦片独立转换几何，不做跨瓦片顶点缝合               |
| **影响**   | 道路/河流在瓦片边界可能出现断裂或重叠                |
| **方案**   | 检测瓦片边缘顶点并与相邻瓦片合并（实现复杂度高）     |
| **优先级** | P2                                                   |

### 10. compileSymbolStyle 编译大量未使用表达式

| 维度       | 详情                                                      |
| ---------- | --------------------------------------------------------- |
| **位置**   | `src/mvt/style/renderer.ts:365-520`                       |
| **问题**   | 无条件编译 40+ 属性表达式，即使 feature 实际只用少数几个  |
| **影响**   | 100+ symbol layers 时初始化编译时间达数秒                 |
| **方案**   | 延迟编译（首次访问时编译），或按 style 实际使用的属性裁剪 |
| **优先级** | P2                                                        |

### 11. fontStackToCss 对空数组处理不严谨

| 维度       | 详情                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| **位置**   | `src/mvt/render/label.ts:628-642`                                        |
| **问题**   | `text-font` evaluates 到 `['']` 时 normalize 后返回空数组，触发 fallback |
| **影响**   | 字体与其他 style 属性不一致                                              |
| **方案**   | 空数组时保留原始表达式返回值而非 fallback                                |
| **优先级** | P2                                                                       |

---

## 四、架构级局限

### 13. 双图层架构固有复杂度

`MvtImageryProvider` + `CesiumMvtPrimitiveLayer` 导致生命周期分裂、状态一致性难保证、调试困难。长期可考虑纯 Primitive 方案。

### 14. 不支持动态样式热更新

样式在构造时编译后不可变。切换主题需销毁全部 provider 并重新解码瓦片。

### 15. 不支持 `pickFeatures`

`provider.ts:116` 直接返回 `undefined`，用户无法点击获取要素属性。

### 16. 私有 Cesium API 依赖

`globe._surface._tilesToRender` 在 `source.ts:135` 使用，Cesium 升级可能静默失效。

---

## 五、已完成事项

- [x] Worker 池并行解码
- [x] 请求可取消（AbortController + 协议）
- [x] 坐标转换预计算（TileTransformContext）
- [x] Symbol diff/reconcile（不再全量 clear）
- [x] Tile cover 归一化（父子层级不重复显示）
- [x] 失败退避机制（指数退避，最大 4s）
- [x] 构造异常清理
- [x] TextSpriteAtlas 内存上限（maxBuckets / maxEntries / LRU）
- [x] 按需渲染模式（requestRender）
- [x] 标签悬挂（相机移动/加载期间暂停）
- [x] 私有 API 守卫（optional chaining + 降级路径）

---

## 六、建议实施顺序

1. **TileCache.trim() 优化** — 低成本高收益，减少 GC 压力
2. **瓦片排序 FIFO 修复** — 一行代码改动
3. **wrapSymbolText 中文字符适配** — 小改动，改善 CJK 用户体验
4. **buildTileUrl 异常保护** — 防御性编程
5. **TextSpriteAtlas 双路径一致性** — 修复 label 闪烁
6. **Symbol 碰撞索引复用** — 减少每帧分配
7. **estimateSceneZoom 地形感知** — 按需接入 terrain sample
