export interface ComputeOptimalWorkerCountOptions {
  maxWorkers?: number;
  minWorkers?: number;
}

export function computeOptimalWorkerCount(
  options: ComputeOptimalWorkerCountOptions = {},
): number {
  const { minWorkers = 2, maxWorkers = 8 } = options;

  const hardwareConcurrency
    = (globalThis as any).navigator?.hardwareConcurrency;

  if (!hardwareConcurrency || !Number.isFinite(hardwareConcurrency)) {
    return Math.max(minWorkers, Math.min(4, maxWorkers));
  }

  const optimalCount = Math.min(hardwareConcurrency, maxWorkers);

  return Math.max(optimalCount, minWorkers);
}
