# 开发命令

## 核心命令

- `pnpm dev` - 启动开发服务器
- `pnpm build` - 类型检查 + 构建（顺序重要：vue-tsc 在 vite 之前）
- `pnpm preview` - 预览构建产物
- `pnpm test` - 运行所有 vitest 测试
- `pnpm lint:eslint --fix` - ESLint 自动修复
- `pnpm lint:tsc` - TypeScript 类型检查
- `pnpm taze -w -r major` - 更新依赖

## 运行单个测试

```bash
# 运行特定测试文件
pnpm vitest run tests/label.test.ts

# 运行匹配名称的测试
pnpm vitest run -t "fontStackToCss"

# 监听模式运行测试
pnpm vitest tests/label.test.ts

# 运行特定 describe 块
pnpm vitest run -t "buildSymbolDedupeKey"
```

## 运行 ESLint 特定文件

```bash
pnpm lint:eslint src/mvt/provider.ts
```

# 项目结构

- `src/mvt/` - 核心 MVT 渲染库
  - `provider.ts` - 主入口 Cesium MvtImageryProvider
  - `scheduler/` - 瓦片调度（scheduler.ts 调度器, source.ts 来源缓存, cache.ts 缓存）
  - `render/` - 渲染模块（layer.ts 核心图层, point/line-string/polygon 几何渲染, label/text 标注, collision/dedupe 碰撞检测）
  - `style/` - 样式处理（document.ts MapLibre 文档, renderer.ts 渲染器, expressions.ts 表达式）
  - `worker/` - Web Worker（worker.ts, client.ts, protocol.ts）
  - `request/` - 请求处理（image.ts 图片缓存, template.ts URL 模板, job.ts 任务）
  - `utils/` - 工具函数
  - `types.ts` - 类型定义
- `src/components/` - Vue 组件（Viewer, MvtScene）
- `src/integrations/` - 第三方集成（openfreemap）
- `tests/` - vitest 测试

# 代码风格

## TypeScript 配置

- 严格模式：`strict: true`
- 禁止未使用变量/参数：`noUnusedLocals`, `noUnusedParameters`
- 禁止 switch case 穿透：`noFallthroughCasesInSwitch`
- 使用 `@vue/tsconfig/tsconfig.dom.json` 作为基础配置

## 导入规范

- 使用 `@antfu/eslint-config` 配置
- 类型导入使用 `import type` 语法
- 允许 `require` 导入（`ts/no-require-imports: off`）
- 导入顺序：外部库 → 内部模块（eslint 自动排序）

## 格式化

- 使用分号：`semi: true`
- 启用格式化器：`formatters: true`
- Vue 模板属性：单行最多 5 个（`vue/max-attributes-per-line`）

## 命名约定

- 类名：PascalCase（如 `MvtImageryProvider`, `TileScheduler`）
- 接口名：PascalCase（如 `MvtProviderOptions`, `TileCoord`）
- 函数/变量：camelCase（如 `createTileDecodeJob`, `tileRequestSource`）
- 常量：camelCase 或 UPPER_CASE（如 `devicePixelRatio`）
- 文件名：kebab-case 或 camelCase（如 `provider.ts`, `text-atlas.test.ts`）
- 类型别名：PascalCase（如 `TileGeometryType`, `SchedulerListener`）

## 类型规范

- 优先使用 `interface` 定义对象类型
- 使用 `type` 定义联合类型、交叉类型、工具类型
- 导出类型使用 `export type` 或 `export interface`
- 避免使用 `any`，优先使用 `unknown` 或具体类型
- Cesium 类型从 `cesium` 包导入

## 错误处理

- 使用 `try/catch` 处理可能抛出异常的代码
- 构造函数中失败时需清理已创建的资源（见 `provider.ts:98-106`）
- 使用 `?.` 可选链进行安全访问
- 抛出原始错误而非包装（`throw error`）

## 测试规范

- 使用 `vitest` 框架
- 测试文件命名：`*.test.ts`
- 使用 `describe` / `it` / `expect` 组织测试
- 使用 `beforeEach` / `afterEach` 设置/清理
- Canvas 相关测试使用 mock（见 `tests/setup.ts`）
- 使用 `vi.fn()` 创建 mock 函数
- 使用 `vi.stubGlobal` mock 全局变量

## Vue 组件规范

- 使用 `<script setup>` 语法
- 组件名：PascalCase
- Props 使用 TypeScript 类型定义

# 规则

- 请始终使用中文进行交流
- 不要编写无意义的桥接函数、类、文件
- 编写新代码时不要总想着兼容旧代码，或者只是打补丁，要从根本上解决问题
- 修改代码后运行 `pnpm lint:eslint --fix` 和 `pnpm lint:tsc` 确保通过检查
- 新功能需编写对应测试
- 必要时添加对应代码注释
