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

export function formatErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message && message !== 'undefined'
      ? message
      : fallbackMessage;
  }

  if (typeof error === 'string') {
    const message = error.trim();
    return message && message !== 'undefined'
      ? error
      : fallbackMessage;
  }

  return fallbackMessage;
}

export function resolveUrl(resourceUrl: string, baseUrl: string): string {
  return new URL(resourceUrl, baseUrl)
    .toString()
    .replaceAll('%7B', '{')
    .replaceAll('%7D', '}');
}
