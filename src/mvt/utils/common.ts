export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function createAbortError(): Error {
  return Object.assign(new Error('aborted'), {
    name: 'AbortError',
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function resolveUrl(resourceUrl: string, baseUrl: string): string {
  return new URL(resourceUrl, baseUrl)
    .toString()
    .replaceAll('%7B', '{')
    .replaceAll('%7D', '}');
}
