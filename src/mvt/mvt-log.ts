export function isMvtDebugLoggingEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) {
    return explicit;
  }

  return Boolean(import.meta.env?.DEV);
}

export function logMvtWarning(enabled: boolean, message: string, details?: unknown): void {
  if (!enabled || typeof console === 'undefined') {
    return;
  }

  if (details === undefined) {
    console.warn(`[MVT] ${message}`);
    return;
  }

  console.warn(`[MVT] ${message}`, details);
}

export function logMvtError(enabled: boolean, message: string, details?: unknown): void {
  if (!enabled || typeof console === 'undefined') {
    return;
  }

  if (details === undefined) {
    console.error(`[MVT] ${message}`);
    return;
  }

  console.error(`[MVT] ${message}`, details);
}
