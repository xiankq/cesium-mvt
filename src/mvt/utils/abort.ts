export function createAbortError(): Error {
  return Object.assign(new Error('aborted'), {
    name: 'AbortError',
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
