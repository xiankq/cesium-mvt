export interface TilePriorityOptions {
  distanceToCamera: number;
  screenSpaceError: number;
  level: number;
  isLoaded: boolean;
}

export function computeTilePriority(options: TilePriorityOptions): number {
  if (options.isLoaded) {
    return -Number.MAX_VALUE;
  }

  const distanceScore = 1 / (1 + options.distanceToCamera);
  const sseScore = options.screenSpaceError;
  const levelScore = 1 / (1 + options.level);

  return distanceScore + sseScore + levelScore;
}
