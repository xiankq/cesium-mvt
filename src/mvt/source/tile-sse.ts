export interface ComputeScreenSpaceErrorOptions {
  geometricError: number;
  distance: number;
  viewportHeight: number;
  sseDenominator?: number;
}

export function computeScreenSpaceError({
  geometricError,
  distance,
  viewportHeight,
  sseDenominator = 0.5,
}: ComputeScreenSpaceErrorOptions): number {
  if (geometricError === 0) {
    return 0;
  }

  return (geometricError * viewportHeight) / (distance * sseDenominator);
}
