/**
 * FrameState 相关工具函数
 *
 * 提供与 Cesium FrameState 相关的辅助函数。
 */

interface CesiumFrameState {
  passes?: {
    pick?: boolean;
  };
}

/**
 * 检查当前帧是否可以更新 Cesium 集合
 *
 * 在 Cesium 渲染循环中，某些帧可能不适合进行集合更新，
 * 例如当场景正在拾取或进行其他特殊操作时。
 *
 * @param frameState - Cesium FrameState 对象
 * @returns 如果可以更新集合则返回 true
 */
export function canUpdateCesiumCollections(frameState: unknown): boolean {
  const state = frameState as CesiumFrameState | undefined;
  return Boolean(state && !state.passes?.pick);
}
