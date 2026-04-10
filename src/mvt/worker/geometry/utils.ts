export const DEFAULT_EXTENT = 4096;

export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
