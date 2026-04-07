import type { SpriteSpecification } from '@maplibre/maplibre-gl-style-spec';

interface SpriteSourceEntry {
  id?: string;
  url: string;
}

interface SpriteMetadataEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio?: number;
  sdf?: boolean;
}

export interface SpriteAtlasEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
  sdf: boolean;
}

function resolveSpriteSource(sprite?: SpriteSpecification): SpriteSourceEntry | undefined {
  if (!sprite) {
    return undefined;
  }

  if (typeof sprite === 'string') {
    return { url: sprite };
  }

  const first = sprite.find(entry => entry && typeof entry.url === 'string');
  if (!first) {
    return undefined;
  }

  return {
    id: first.id,
    url: first.url,
  };
}

function normalizeSpriteBaseUrl(url: string): string {
  return url.replace(/(@2x)?\.(json|png)$/i, '').replace(/@2x$/i, '');
}

function buildSpriteUrl(baseUrl: string, pixelRatio: number, extension: 'json' | 'png'): string {
  const suffix = pixelRatio > 1 ? '@2x' : '';
  return `${baseUrl}${suffix}.${extension}`;
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return fetch(url, { signal })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load sprite image: ${url}`);
      }

      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);
        let settled = false;

        const cleanup = () => {
          if (signal) {
            signal.removeEventListener('abort', handleAbort);
          }
          URL.revokeObjectURL(objectUrl);
        };

        const finishResolve = () => {
          if (settled)
            return;
          settled = true;
          cleanup();
          resolve(image);
        };

        const finishReject = (error: Error) => {
          if (settled)
            return;
          settled = true;
          cleanup();
          reject(error);
        };

        const handleAbort = () => {
          finishReject(new Error('Sprite loading was aborted.'));
        };

        image.onload = finishResolve;
        image.onerror = () => finishReject(new Error(`Failed to decode sprite image: ${url}`));

        if (signal) {
          if (signal.aborted) {
            handleAbort();
            return;
          }

          signal.addEventListener('abort', handleAbort, { once: true });
        }

        image.decoding = 'async';
        image.src = objectUrl;
      });
    });
}

function isValidSpriteMetadataEntry(entry: SpriteMetadataEntry): boolean {
  return (
    Number.isFinite(entry.x)
    && Number.isFinite(entry.y)
    && Number.isFinite(entry.width)
    && Number.isFinite(entry.height)
    && entry.width > 0
    && entry.height > 0
  );
}

export class MapLibreSpriteAtlas {
  private readonly baseUrl?: string;
  private readonly preferredPixelRatio: number;
  private loadPromise?: Promise<void>;
  private loaded = false;
  private sourceImage?: HTMLImageElement;
  private readonly entries = new Map<string, SpriteAtlasEntry>();
  private readonly canvases = new Map<string, HTMLCanvasElement>();

  constructor(sprite?: SpriteSpecification, preferredPixelRatio = globalThis.devicePixelRatio ?? 1) {
    const source = resolveSpriteSource(sprite);
    this.baseUrl = source ? normalizeSpriteBaseUrl(source.url) : undefined;
    this.preferredPixelRatio = Number.isFinite(preferredPixelRatio) && preferredPixelRatio > 0
      ? preferredPixelRatio
      : 1;
  }

  get isReady(): boolean {
    return this.loaded;
  }

  resolve(id: string): SpriteAtlasEntry | undefined {
    return this.entries.get(id);
  }

  async load(signal?: AbortSignal): Promise<void> {
    if (!this.baseUrl || this.loaded) {
      return;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadInternal(signal).finally(() => {
      this.loadPromise = undefined;
    });
    return this.loadPromise;
  }

  getImage(id: string): HTMLCanvasElement | undefined {
    if (!this.loaded || !this.sourceImage) {
      return undefined;
    }

    const cached = this.canvases.get(id);
    if (cached) {
      return cached;
    }

    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(entry.width / entry.pixelRatio));
    canvas.height = Math.max(1, Math.round(entry.height / entry.pixelRatio));

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    context.drawImage(
      this.sourceImage,
      entry.x,
      entry.y,
      entry.width,
      entry.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    this.canvases.set(id, canvas);
    return canvas;
  }

  private async loadInternal(signal?: AbortSignal): Promise<void> {
    if (!this.baseUrl) {
      return;
    }

    const pixelRatios = Array.from(
      new Set([
        Math.max(1, Math.round(this.preferredPixelRatio)),
        2,
        1,
      ]),
    );

    let lastError: Error | undefined;
    for (const pixelRatio of pixelRatios) {
      try {
        const jsonUrl = buildSpriteUrl(this.baseUrl, pixelRatio, 'json');
        const pngUrl = buildSpriteUrl(this.baseUrl, pixelRatio, 'png');

        const response = await fetch(jsonUrl, { signal });
        if (!response.ok) {
          throw new Error(`Failed to load sprite metadata: ${jsonUrl}`);
        }

        const metadata = (await response.json()) as Record<string, SpriteMetadataEntry>;
        const image = await loadImage(pngUrl, signal);

        this.entries.clear();
        for (const [id, entry] of Object.entries(metadata)) {
          if (!entry || typeof entry !== 'object' || !isValidSpriteMetadataEntry(entry)) {
            continue;
          }

          this.entries.set(id, {
            id,
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
            pixelRatio: Number.isFinite(entry.pixelRatio) && entry.pixelRatio && entry.pixelRatio > 0 ? entry.pixelRatio : pixelRatio,
            sdf: Boolean(entry.sdf),
          });
        }

        this.sourceImage = image;
        this.loaded = true;
        return;
      }
      catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error(`Failed to load sprite atlas from ${this.baseUrl}.`);
  }
}
