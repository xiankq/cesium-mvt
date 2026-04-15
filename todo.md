# Cesium / MapLibre 性能差异收敛 TODO

## P0

- [x] `feature-state` 增量刷新
  - 目标文件：`src/mvt/style/feature-state-store.ts`、`src/mvt/cesium-vector-tile-coordinator.ts`、`src/mvt/render/render-manager.ts`、`src/mvt/render/bucket-rendered-tile.ts`
  - 目标：`setFeatureState` 只刷新受影响的 `sourceId` / `sourceLayer` / tile，不再整源重刷。
  - 验收：`sourceLayer` 已知时只刷新匹配瓦片；`sourceLayer` 未知时保持 source 级刷新。

- [x] tile cache / 容器化
  - 目标文件：`src/mvt/utils/tile-cache.ts`、`src/mvt/render/bucket-rendered-tile.ts`、`src/mvt/source/tile-cache-manager.ts`
  - 目标：瓦片容器以 tile 级为单位管理挂载、隐藏、驱逐，驱逐语义贴近 Cesium 的帧标记 + LRU。
  - 验收：驱逐顺序、overflow 语义、隐藏/显示生命周期不变，减少 root 上逐 primitive 操作。

## P1

- [x] request / selection 去重
  - 目标文件：`src/mvt/cesium-vector-tile-coordinator.ts`、`src/mvt/source/tile-selection.ts`
  - 目标：同一帧内对重复坐标、overscaled 重复候选做早期去重，避免重复排序、重复请求、重复 abort。
  - 验收：重复候选只发起一次请求，优先级顺序不变。

- [x] zero-copy cache boundary
  - 目标文件：`src/mvt/source/source-cache.ts`、`src/mvt/source/geojson-source-cache.ts`
  - 目标：把“内部缓存原始 buffer”和“交给 worker / 外部的转移副本”拆开，减少 `ArrayBuffer.slice` 和重复 clone。
  - 验收：缓存命中不再额外复制原始 buffer，外部返回值仍然安全可转移。

- [x] query / render 缓存
  - 目标文件：`src/mvt/render/render-query.ts`、`src/mvt/render/render-query-utils.ts`、`src/mvt/render/render-manager.ts`
  - 目标：预计算 renderable layers、source-layer 列表、symbol 可见索引和坐标解析结果。
  - 验收：减少 `Array.from`、`flatMap`、`localeCompare`、重复坐标解析和重复 clone。

## P2

- [x] bucket / text shaping 热路径
  - 目标文件：`src/mvt/bucket/bucket-tile-compiler.ts`、`src/mvt/bucket/*`、`src/mvt/render/backend/*`
  - 目标：清掉热路径中的 `Array.from` / `slice` / `localeCompare` / 额外 text shaping 分配，补 scratch 复用。

- [x] style / loader cleanup
  - 目标文件：`src/mvt/style/filter-adapter.ts`、`src/mvt/style/style-loader.ts`、`src/mvt/style/style-expression-cache.ts`
  - 目标：收敛 `JSON.stringify`、deepClone、重复 cache，保留单一实现。

## 本轮已完成

- [x] `feature-state` sourceLayer 级增量刷新
- [x] 同帧重复瓦片请求去重
- [x] tile 级容器化与 root 级单次挂载/驱逐
- [x] `peekEntryValue` 优先的零拷贝查询边界
- [x] render / source 查询缓存预计算
- [x] bucket / text shaping 热路径收敛
- [x] style loader / cache 收敛
