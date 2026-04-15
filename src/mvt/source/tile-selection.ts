import type { TileCoordinate } from './tile-request';

/**
 * 瓦片选择模块
 *
 * 该模块负责根据当前视图和数据源约束，确定需要请求、显示或作为后备的瓦片集合。
 *
 * 核心概念：
 * - TileAvailability: 瓦片可用性状态（ready/empty/missing）
 * - TileSelection: 瓦片选择结果，包含就绪、空、后备和请求坐标
 * - Fallback: 当请求的瓦片不可用时，使用祖先瓦片作为后备
 */

/**
 * 瓦片可用性状态
 *
 * - ready: 瓦片已加载且包含数据
 * - empty: 瓦片已加载但不包含数据
 * - missing: 瓦片尚未加载
 */
export type TileAvailability = 'empty' | 'missing' | 'ready';

/**
 * 解析瓦片选择的选项
 */
export interface ResolveTileSelectionOptions {
  coordinates: readonly TileCoordinate[];
  getAvailability: (coordinate: TileCoordinate) => TileAvailability;
  minimumLevel: number;
  maximumLevel?: number;
}

/**
 * 瓦片选择结果
 */
export interface TileSelection {
  emptyCoordinates: TileCoordinate[];
  fallbackCoordinates: TileCoordinate[];
  readyCoordinates: TileCoordinate[];
  requestCoordinates: TileCoordinate[];
}

/**
 * 解析瓦片选择
 *
 * 根据瓦片可用性和数据源约束，确定最终的瓦片选择结果
 *
 * 算法步骤：
 * 1. 调整坐标：将超出数据源范围的坐标映射到有效范围
 * 2. 扩展坐标：将低于最小层级的坐标扩展为子瓦片
 * 3. 分类坐标：根据可用性分为就绪、空和请求三类
 * 4. 查找后备：为请求的瓦片查找可用的祖先瓦片
 * 5. 优化后备：移除被完全覆盖的祖先瓦片
 *
 * @param options - 解析选项
 * @param options.coordinates - 瓦片坐标数组
 * @param options.getAvailability - 获取瓦片可用性的函数
 * @param options.minimumLevel - 最小层级
 * @param options.maximumLevel - 最大层级（可选）
 * @returns 瓦片选择结果
 */
export function resolveTileSelection({
  coordinates,
  getAvailability,
  minimumLevel,
  maximumLevel,
}: ResolveTileSelectionOptions): TileSelection {
  const readyCoordinates: TileCoordinate[] = [];
  const emptyCoordinates: TileCoordinate[] = [];
  const requestCoordinates: TileCoordinate[] = [];
  const descendantCoverageByAncestorKey = new Map<string, {
    resolved: number;
    total: number;
  }>();
  const seenCoordinateKeys = new Set<string>();

  // 当请求的层级低于数据源最小层级时，需要生成所有对应的子瓦片
  // 例如：level=8 的一个瓦片对应 level=10 的 4 个子瓦片
  const expandedCoordinates: TileCoordinate[] = [];
  for (const coordinate of coordinates) {
    let adjustedCoordinate = coordinate;

    // 当请求的瓦片层级超过数据源的最大层级时，需要将坐标映射到最大层级
    // 例如：请求 level=18，但数据源最大只到 level=14，则映射到 level=14 的父瓦片
    if (maximumLevel !== undefined && coordinate.level > maximumLevel) {
      const levelDiff = coordinate.level - maximumLevel;
      adjustedCoordinate = {
        level: maximumLevel,
        x: Math.floor(coordinate.x / 2 ** levelDiff),
        y: Math.floor(coordinate.y / 2 ** levelDiff),
      };
    }

    // 当请求的瓦片层级低于数据源的最小层级时，需要生成所有对应的子瓦片
    // 例如：请求 level=8，但数据源最小从 level=10 开始，则生成 level=10 的所有子瓦片
    if (adjustedCoordinate.level < minimumLevel) {
      const levelDiff = minimumLevel - adjustedCoordinate.level;
      const baseX = adjustedCoordinate.x * 2 ** levelDiff;
      const baseY = adjustedCoordinate.y * 2 ** levelDiff;
      const count = 2 ** levelDiff;

      for (let dx = 0; dx < count; dx++) {
        for (let dy = 0; dy < count; dy++) {
          appendUniqueCoordinate(expandedCoordinates, seenCoordinateKeys, {
            level: minimumLevel,
            x: baseX + dx,
            y: baseY + dy,
          });
        }
      }
    }
    else {
      appendUniqueCoordinate(expandedCoordinates, seenCoordinateKeys, adjustedCoordinate);
    }
  }

  for (const adjustedCoordinate of expandedCoordinates) {
    const availability = getAvailability(adjustedCoordinate);

    let ancestor = getParentCoordinate(adjustedCoordinate);
    while (ancestor && ancestor.level >= minimumLevel) {
      const ancestorKey = createCoordinateKey(ancestor);
      const coverage = descendantCoverageByAncestorKey.get(ancestorKey);
      if (coverage) {
        coverage.total += 1;
        if (availability !== 'missing') {
          coverage.resolved += 1;
        }
      }
      else {
        descendantCoverageByAncestorKey.set(ancestorKey, {
          resolved: availability !== 'missing' ? 1 : 0,
          total: 1,
        });
      }

      ancestor = getParentCoordinate(ancestor);
    }

    if (availability === 'ready') {
      readyCoordinates.push(adjustedCoordinate);
      continue;
    }

    if (availability === 'empty') {
      emptyCoordinates.push(adjustedCoordinate);
      continue;
    }

    requestCoordinates.push(adjustedCoordinate);
  }

  const fallbackCoordinatesByKey = new Map<string, TileCoordinate>();
  for (const coordinate of requestCoordinates) {
    const fallbackCoordinate = findFallbackCoordinate({
      coordinate,
      getAvailability,
      minimumLevel,
    });
    if (!fallbackCoordinate) {
      continue;
    }

    // 只有当当前可见范围内、属于这个祖先的子瓦片都已经 resolved 时，
    // 才能安全移除祖先 fallback；否则会在未就绪的子区域留下白洞。
    if (isFullyCoveredByResolvedVisibleDescendants(
      descendantCoverageByAncestorKey,
      fallbackCoordinate,
    )) {
      continue;
    }

    fallbackCoordinatesByKey.set(
      createCoordinateKey(fallbackCoordinate),
      fallbackCoordinate,
    );
  }

  return {
    emptyCoordinates,
    fallbackCoordinates: [...fallbackCoordinatesByKey.values()],
    readyCoordinates,
    requestCoordinates,
  };
}

function appendUniqueCoordinate(
  coordinates: TileCoordinate[],
  seenCoordinateKeys: Set<string>,
  coordinate: TileCoordinate,
): void {
  const key = createCoordinateKey(coordinate);
  if (seenCoordinateKeys.has(key)) {
    return;
  }

  seenCoordinateKeys.add(key);
  coordinates.push(coordinate);
}

/**
 * 查找后备瓦片坐标
 *
 * 从当前坐标向上查找祖先瓦片，返回第一个可用的祖先
 *
 * @param params - 查找参数
 * @param params.coordinate - 当前瓦片坐标
 * @param params.getAvailability - 获取瓦片可用性的函数
 * @param params.minimumLevel - 最小层级
 * @returns 后备瓦片坐标，如果没有则返回 undefined
 */
function findFallbackCoordinate({
  coordinate,
  getAvailability,
  minimumLevel,
}: {
  coordinate: TileCoordinate;
  getAvailability: (coordinate: TileCoordinate) => TileAvailability;
  minimumLevel: number;
}): TileCoordinate | undefined {
  let ancestor = getParentCoordinate(coordinate);
  let highestEmptyAncestor: TileCoordinate | undefined;

  while (ancestor && ancestor.level >= minimumLevel) {
    const availability = getAvailability(ancestor);
    if (availability === 'ready') {
      return ancestor;
    }

    if (availability === 'empty') {
      highestEmptyAncestor = ancestor;
    }

    ancestor = getParentCoordinate(ancestor);
  }

  return highestEmptyAncestor;
}

/**
 * 检查祖先瓦片是否被已解析的后代瓦片完全覆盖
 * 这里直接读聚合后的计数，避免每个 fallback 候选都重新扫一遍 expandedCoordinates。
 */
function isFullyCoveredByResolvedVisibleDescendants(
  descendantCoverageByAncestorKey: ReadonlyMap<string, {
    resolved: number;
    total: number;
  }>,
  ancestor: TileCoordinate,
): boolean {
  const coverage = descendantCoverageByAncestorKey.get(createCoordinateKey(ancestor));
  return Boolean(coverage && coverage.total > 0 && coverage.resolved === coverage.total);
}

/**
 * 获取父坐标
 *
 * @param coordinate - 当前坐标
 * @returns 父坐标，如果是顶层则返回 undefined
 */
function getParentCoordinate(coordinate: TileCoordinate): TileCoordinate | undefined {
  if (coordinate.level === 0) {
    return undefined;
  }

  return {
    level: coordinate.level - 1,
    x: Math.floor(coordinate.x / 2),
    y: Math.floor(coordinate.y / 2),
  };
}

/**
 * 创建坐标键
 *
 * @param coordinate - 瓦片坐标
 * @returns 坐标键字符串
 */
function createCoordinateKey(coordinate: TileCoordinate): string {
  return `${coordinate.level}/${coordinate.x}/${coordinate.y}`;
}
