# Worker Bucket Builder 架构设计

## 设计目标

根据 achieve-desc.md 阶段1的要求，worker需要实现：

1. **真正的bucket builder**：按MapLibre的bucket populate阶段组织
2. **Typed arrays输出**：不输出geometry对象，减少数据传输
3. **预先统计buffer容量**：主线程可以一次性精确分配collection
4. **Globe投影与几何细分**：在worker中执行投影计算

## 核心概念

### Bucket

Bucket是worker输出的核心单元，对应一个layer family的所有几何数据：

```typescript
interface Bucket {
  type: 'fill' | 'line' | 'circle';
  familyId: string;
  layerIds: string[];

  // 统计信息，用于主线程一次性分配collection
  stats: BucketStats;

  // Typed arrays，直接传输到主线程
  data: BucketData;

  // Feature index信息，用于查询
  featureIndex: FeatureIndex;
}
```

### BucketStats

预先统计的容量信息：

```typescript
interface BucketStats {
  // Fill bucket stats
  vertexCount?: number;
  triangleCount?: number;
  holeCount?: number;

  // Line bucket stats
  polylineCount?: number;
  totalVertexCount?: number;

  // Circle bucket stats
  pointCount?: number;

  // 通用
  featureCount: number;
  byteLength: number;
}
```

### BucketData

Typed arrays数据：

```typescript
interface FillBucketData {
  positions: Float64Array; // [x, y, z, x, y, z, ...]
  triangles: Uint32Array; // 三角形索引
  holes: Uint32Array; // 孔洞偏移量
  featureIds: Float64Array; // 每个顶点对应的feature id
}

interface LineBucketData {
  positions: Float64Array; // [x, y, z, x, y, z, ...]
  vertexCounts: Uint32Array; // 每条线的顶点数
  featureIds: Float64Array; // 每条线对应的feature id
}

interface CircleBucketData {
  positions: Float64Array; // [x, y, z, x, y, z, ...]
  featureIds: Float64Array; // 每个点对应的feature id
}
```

### FeatureIndex

用于查询的feature索引：

```typescript
interface FeatureIndex {
  // feature id -> feature properties
  properties: Map<number, Record<string, unknown>>;

  // bucket内局部索引 -> source feature
  localToSource: Map<number, {
    id: number | undefined;
    properties: Record<string, unknown>;
    type: 'point' | 'line' | 'polygon';
  }>;
}
```

## 架构分层

### 1. Worker入口层 (feature-tile.worker.ts)

保持现有架构，但修改输出结构：

```typescript
// 输入：RenderTile + ArrayBuffer
interface WorkerInput {
  renderTile: RenderTile;
  tileData: ArrayBuffer;
}

// 输出：ParsedTileResult
interface ParsedTileResult {
  buckets: Bucket[];
  epoch: number;
  key: string;
  byteLength: number;
}
```

### 2. Bucket Builder层 (worker/bucket/)

按几何类型分离：

```
worker/bucket/
  bucket-builder.ts          # 基础接口
  fill-bucket-builder.ts     # Fill bucket builder
  line-bucket-builder.ts     # Line bucket builder
  circle-bucket-builder.ts   # Circle bucket builder
```

### 3. 几何处理层 (worker/geometry/)

投影和细分：

```
worker/geometry/
  tile-projection.ts         # Globe投影
  line-subdivision.ts        # Line细分
  fill-subdivision.ts        # Fill边界细分
  chord-error.ts             # Chord error计算
```

### 4. Feature Index层 (worker/feature-index.ts)

构建feature索引：

```typescript
interface FeatureIndexBuilder {
  addFeature: (feature: VectorTileFeature, localId: number) => void;
  build: () => FeatureIndex;
}
```

## 实现流程

### Worker处理流程

```
1. 接收 RenderTile + ArrayBuffer
   ↓
2. 解析 PBF -> VectorTile
   ↓
3. 按 layer family 分组 features
   ↓
4. 对每个 family 创建 bucket builder
   ↓
5. 遍历 features，populate bucket
   - 投影到 globe
   - 几何细分（如果需要）
   - 添加到 bucket data
   - 更新 stats
   - 构建 feature index
   ↓
6. 输出 ParsedTileResult
   - buckets: Bucket[]
   - byteLength: number
   - featureIndex: FeatureIndex
```

### 主线程处理流程

```
1. 接收 ParsedTileResult
   ↓
2. 遍历 buckets
   ↓
3. 根据 stats 创建 collection
   - new BufferPolygonCollection({ vertexCountMax, ... })
   - new BufferPolylineCollection({ primitiveCountMax, ... })
   - new BufferPointCollection({ primitiveCountMax })
   ↓
4. 直接使用 typed arrays 填充 collection
   - 不需要重新遍历 geometry
   - 不需要重新计算投影
   ↓
5. 挂载到 primitive collection
```

## Globe投影与几何细分

### 投影策略

1. **Tile坐标系 -> WebMercator -> WGS84 -> Cartesian3**
   - 在worker中完成所有投影计算
   - 输出已经是Cartesian3坐标

2. **几何细分条件**
   - Chord error > threshold
   - 角度变化 > threshold
   - Screen-space error > threshold

3. **细分算法**
   - Line: 递归中点细分
   - Fill边界: 保持相邻tile一致性

### 细分参数

```typescript
interface SubdivisionOptions {
  // 最大chord error（米）
  maxChordError?: number; // 默认 10

  // 最大角度变化（弧度）
  maxAngleChange?: number; // 默认 PI/180 * 5 (5度)

  // 最大screen-space error（像素）
  maxScreenSpaceError?: number; // 默认 2
}
```

## 内存管理

### Worker内存

- Worker输出只包含typed arrays和基本类型
- 不包含Cesium对象
- 不包含geometry对象
- byteLength准确估算

### 主线程内存

- 根据stats精确分配collection
- 避免过度分配
- 避免动态扩容

## 性能优化

### 1. 预分配策略

```typescript
// Worker中预先统计
const stats = {
  vertexCount: 0,
  triangleCount: 0,
  holeCount: 0,
};

// 遍历features时累加
for (const feature of features) {
  stats.vertexCount += feature.vertexCount;
  stats.triangleCount += feature.triangleCount;
}

// 主线程一次性分配
const collection = new BufferPolygonCollection({
  vertexCountMax: stats.vertexCount,
  triangleCountMax: stats.triangleCount,
  holeCountMax: stats.holeCount,
});
```

### 2. 零拷贝数据传输（核心优化）

**原则：Worker输出直接作为主线程输入，全程无拷贝**

```typescript
// Worker中直接创建typed arrays
const positions = new Float64Array(stats.vertexCount * 3);
const triangles = new Uint32Array(stats.triangleCount * 3);

// 使用Transferable传输，所有权转移，无拷贝
const response: ParsedTileResult = {
  buckets: [{
    data: {
      positions,
      triangles,
    },
  }],
};

// 主线程接收时，arrays已经是Transferable过来的，无需复制
globalThis.postMessage(response, [
  positions.buffer,
  triangles.buffer,
]);
```

**关键点：**

1. **Typed Arrays直接传输**
   - Worker创建的Float64Array、Uint32Array等直接传输
   - 使用Transferable objects，所有权转移，零拷贝

2. **避免中间对象**
   - 不创建geometry对象
   - 不创建Point[]对象
   - 直接写入typed arrays

3. **主线程直接使用**

   ```typescript
   // 主线程直接使用Transferable过来的arrays
   collection.add({
     positions: bucket.data.positions, // 已经是Transferable过来的
     triangles: bucket.data.triangles, // 无需复制
   });
   ```

4. **Buffer复用**
   ```typescript
   // 对于多个bucket，可以复用同一个ArrayBuffer
   const buffer = new ArrayBuffer(totalByteLength);
   const positions = new Float64Array(buffer, 0, positionCount);
   const triangles = new Uint32Array(buffer, positionByteOffset, triangleCount);
   ```

### 3. 几何细分优化

```typescript
// 只在必要时细分
function shouldSubdivide(
  p1: Cartesian3,
  p2: Cartesian3,
  options: SubdivisionOptions,
): boolean {
  const chordError = calculateChordError(p1, p2);
  return chordError > options.maxChordError;
}

// 递归细分
function subdivideLine(
  points: Cartesian3[],
  options: SubdivisionOptions,
): Cartesian3[] {
  const result: Cartesian3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    result.push(points[i]);
    if (shouldSubdivide(points[i], points[i + 1], options)) {
      const mid = interpolateMidpoint(points[i], points[i + 1]);
      result.push(mid);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
```

## 测试策略

### 单元测试

1. **Bucket Builder测试**
   - 正确统计容量
   - 正确构建typed arrays
   - 正确构建feature index

2. **几何细分测试**
   - Chord error计算正确
   - 细分结果符合预期
   - 边界一致性

3. **投影测试**
   - 坐标转换正确
   - Globe投影正确

### 集成测试

1. **Worker端到端测试**
   - PBF输入 -> Bucket输出
   - 内存使用合理
   - 性能符合预期

2. **主线程集成测试**
   - Bucket输入 -> Collection输出
   - 渲染正确
   - Pick正确

## 迁移计划

### 阶段1：基础架构（1-2天）

1. 创建bucket接口和基础类型
2. 实现基础的bucket builder（不含细分）
3. 修改worker输出结构
4. 修改主线程backend使用新结构

### 阶段2：几何细分（2-3天）

1. 实现chord error计算
2. 实现line细分算法
3. 实现fill边界细分
4. 保证tile边界一致性

### 阶段3：Feature Index（1-2天）

1. 实现feature index builder
2. 支持properties查询
3. 支持pick功能

### 阶段4：优化与测试（2-3天）

1. 性能优化
2. 内存优化
3. 完整测试覆盖
4. 文档完善

## 零拷贝实现细节

### Worker端

```typescript
// 1. 预先统计容量
const stats = calculateBucketStats(features);

// 2. 一次性分配所有buffer
const totalByteLength = calculateTotalByteLength(stats);
const buffer = new ArrayBuffer(totalByteLength);

// 3. 创建typed arrays视图（共享底层buffer）
let offset = 0;
const positions = new Float64Array(buffer, offset, stats.vertexCount * 3);
offset += positions.byteLength;
const triangles = new Uint32Array(buffer, offset, stats.triangleCount * 3);
offset += triangles.byteLength;

// 4. 直接写入数据
let positionIndex = 0;
let triangleIndex = 0;
for (const feature of features) {
  // 直接写入typed arrays，无中间对象
  for (const vertex of feature.vertices) {
    positions[positionIndex++] = vertex.x;
    positions[positionIndex++] = vertex.y;
    positions[positionIndex++] = vertex.z;
  }
  for (const index of feature.triangles) {
    triangles[triangleIndex++] = index;
  }
}

// 5. Transferable传输
const response = {
  buckets: [{
    data: { positions, triangles },
    stats,
  }],
};
globalThis.postMessage(response, [buffer]); // 所有权转移，零拷贝
```

### 主线程端

```typescript
// 1. 接收Transferable数据
worker.onmessage = (event) => {
  const { buckets } = event.data;

  // 2. 直接使用，无需复制
  for (const bucket of buckets) {
    const collection = new BufferPolygonCollection({
      vertexCountMax: bucket.stats.vertexCount,
      triangleCountMax: bucket.stats.triangleCount,
    });

    // 3. 直接添加，底层buffer已转移
    collection.add({
      positions: bucket.data.positions, // 零拷贝
      triangles: bucket.data.triangles, // 零拷贝
    });
  }
};
```

### 性能对比

| 方案                                  | 数据拷贝次数 | 内存占用 | 传输时间 |
| ------------------------------------- | ------------ | -------- | -------- |
| 旧方案（geometry对象）                | 3-4次        | 高       | 慢       |
| 新方案（typed arrays + Transferable） | 0次          | 低       | 快       |

**旧方案流程：**

```
Worker: PBF -> VectorTileFeature -> Point[] -> ExtractedFeature
         ↓ (序列化)
主线程: ExtractedFeature -> Point[] -> Cartesian3[] -> BufferCollection
         ↓ (拷贝)
GPU: BufferCollection内部buffer
```

**拷贝次数：4次**

**新方案流程：**

```
Worker: PBF -> VectorTileFeature -> Typed Arrays (直接写入)
         ↓ (Transferable, 所有权转移)
主线程: Typed Arrays -> BufferCollection (直接使用)
         ↓ (无拷贝)
GPU: BufferCollection内部buffer
```

**拷贝次数：0次**

## 风险与决策

| 风险             | 问题                 | 决策                               |
| ---------------- | -------------------- | ---------------------------------- |
| Worker计算量大   | 可能阻塞其他tile处理 | 使用setTimeout(0)分片处理          |
| Typed arrays传输 | 大数组传输可能慢     | 使用Transferable objects，零拷贝   |
| 几何细分复杂     | 可能引入bug          | 先实现简单版本，逐步完善           |
| 内存估算不准     | 可能导致分配不足     | 预留10%余量                        |
| Buffer所有权转移 | 主线程不能再访问     | 确保Transferable后不再访问原buffer |

## 参考实现

- MapLibre bucket populate
- Cesium BufferPrimitive
- Globe投影算法
