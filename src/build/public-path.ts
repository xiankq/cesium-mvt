export interface ResolvePublicBaseOptions {
  base?: string;
  githubPages?: boolean;
}

export function resolvePublicBase(options: ResolvePublicBaseOptions = {}): string {
  const explicitBase = options.base?.trim();

  if (explicitBase) {
    return normalizeTrailingSlash(explicitBase);
  }

  if (options.githubPages) {
    return '/cesium-mvt/';
  }

  return '/';
}

function normalizeTrailingSlash(value: string): string {
  if (value === '/' || value === './') {
    return value;
  }

  return value.endsWith('/') ? value : `${value}/`;
}
