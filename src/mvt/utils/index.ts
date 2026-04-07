export * from './screen-space';

export function resolveHardwareConcurrency(): number {
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency === undefined) {
    return 4;
  }
  return Math.max(1, Math.floor(hardwareConcurrency));
}
