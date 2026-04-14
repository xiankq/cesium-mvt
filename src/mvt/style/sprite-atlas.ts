import type { ResolvedImage } from '@maplibre/maplibre-gl-style-spec';

export interface SpriteImage {
  image: string;
  height: number;
  pixelRatio: number;
  width: number;
}

export interface SpriteAtlas {
  getImage: (name: string) => SpriteImage | undefined;
}

interface SpriteEntryDefinition {
  height: number;
  pixelRatio?: number;
  x: number;
  y: number;
  width: number;
}

interface SpriteAtlasDefinition {
  [name: string]: SpriteEntryDefinition;
}

interface SpriteImageRequestStyle {
  spriteAtlas?: SpriteAtlas;
}

const IMAGE_REFERENCE_PATTERN = /^(?:data:|blob:|https?:|file:|\/)/i;
const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,';

class LoadedSpriteAtlas implements SpriteAtlas {
  private readonly imageCache = new Map<string, SpriteImage>();
  private readonly entries = new Map<string, SpriteEntryDefinition>();
  private readonly sheetHeight: number;
  private readonly sheetImage: string;
  private readonly sheetWidth: number;

  constructor(
    sheetImage: string,
    sheetHeight: number,
    sheetWidth: number,
    definitions: SpriteAtlasDefinition,
  ) {
    this.sheetImage = sheetImage;
    this.sheetHeight = sheetHeight;
    this.sheetWidth = sheetWidth;

    for (const [name, entry] of Object.entries(definitions)) {
      this.entries.set(name, entry);
    }
  }

  getImage(name: string): SpriteImage | undefined {
    const cached = this.imageCache.get(name);
    if (cached) {
      return cached;
    }

    const entry = this.entries.get(name);
    if (!entry) {
      return undefined;
    }

    const pixelRatio = entry.pixelRatio ?? 1;
    const width = entry.width / pixelRatio;
    const height = entry.height / pixelRatio;
    const image = buildSpriteImage(
      this.sheetImage,
      this.sheetWidth,
      this.sheetHeight,
      entry,
    );
    const spriteImage: SpriteImage = {
      height,
      image,
      pixelRatio,
      width,
    };

    this.imageCache.set(name, spriteImage);
    return spriteImage;
  }
}

export async function loadSpriteAtlas(
  spriteUrl: string,
): Promise<SpriteAtlas> {
  const [spriteJsonResponse, spritePngResponse] = await Promise.all([
    fetch(`${spriteUrl}.json`),
    fetch(`${spriteUrl}.png`),
  ]);

  if (!spriteJsonResponse.ok) {
    throw new Error(`Failed to load sprite atlas JSON: ${spriteUrl}.json`);
  }

  if (!spritePngResponse.ok) {
    throw new Error(`Failed to load sprite atlas image: ${spriteUrl}.png`);
  }

  const spriteDefinitions = await spriteJsonResponse.json() as unknown;
  const definitions = parseSpriteAtlasDefinition(spriteDefinitions);
  const spritePngBuffer = await spritePngResponse.arrayBuffer();
  const spriteImage = toDataUrl(spritePngBuffer);

  return new LoadedSpriteAtlas(
    spriteImage,
    computeAtlasHeight(definitions),
    computeAtlasWidth(definitions),
    definitions,
  );
}

export function resolveStyleImage(
  style: unknown,
  image: string | ResolvedImage | undefined,
): SpriteImage | undefined {
  const imageName = resolveStyleImageName(image);
  if (!imageName) {
    return undefined;
  }

  if (!hasSpriteAtlas(style)) {
    return IMAGE_REFERENCE_PATTERN.test(imageName)
      ? createExternalImage(imageName)
      : undefined;
  }

  const atlasImage = style.spriteAtlas.getImage(imageName);
  if (atlasImage) {
    return atlasImage;
  }

  return IMAGE_REFERENCE_PATTERN.test(imageName)
    ? createExternalImage(imageName)
    : undefined;
}

export function resolveStyleImageName(
  image: string | ResolvedImage | undefined,
): string | undefined {
  if (!image) {
    return undefined;
  }

  if (typeof image === 'string') {
    return image;
  }

  return image.name;
}

function hasSpriteAtlas(
  style: unknown,
): style is SpriteImageRequestStyle & { spriteAtlas: SpriteAtlas } {
  if (!isRecord(style) || !('spriteAtlas' in style)) {
    return false;
  }

  return style.spriteAtlas !== undefined && style.spriteAtlas !== null;
}

function parseSpriteAtlasDefinition(
  value: unknown,
): SpriteAtlasDefinition {
  if (!isRecord(value)) {
    throw new Error('Sprite atlas JSON must be an object.');
  }

  const definitions: SpriteAtlasDefinition = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isSpriteEntryDefinition(entry)) {
      throw new Error(`Sprite atlas entry '${name}' is invalid.`);
    }

    definitions[name] = {
      height: entry.height,
      pixelRatio: entry.pixelRatio,
      x: entry.x,
      y: entry.y,
      width: entry.width,
    };
  }

  return definitions;
}

function isSpriteEntryDefinition(value: unknown): value is SpriteEntryDefinition {
  return isRecord(value)
    && typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && (typeof value.pixelRatio === 'number' || typeof value.pixelRatio === 'undefined');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function computeAtlasWidth(definitions: SpriteAtlasDefinition): number {
  let width = 0;
  for (const entry of Object.values(definitions)) {
    width = Math.max(width, entry.x + entry.width);
  }
  return Math.max(width, 1);
}

function computeAtlasHeight(definitions: SpriteAtlasDefinition): number {
  let height = 0;
  for (const entry of Object.values(definitions)) {
    height = Math.max(height, entry.y + entry.height);
  }
  return Math.max(height, 1);
}

function buildSpriteImage(
  sheetImage: string,
  sheetWidth: number,
  sheetHeight: number,
  entry: SpriteEntryDefinition,
): string {
  const pixelRatio = entry.pixelRatio ?? 1;
  const displayWidth = entry.width / pixelRatio;
  const displayHeight = entry.height / pixelRatio;
  const sheetDisplayWidth = sheetWidth / pixelRatio;
  const sheetDisplayHeight = sheetHeight / pixelRatio;
  const x = -(entry.x / pixelRatio);
  const y = -(entry.y / pixelRatio);

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ' xmlns:xlink="http://www.w3.org/1999/xlink"',
    ` width="${displayWidth}"`,
    ` height="${displayHeight}"`,
    ` viewBox="0 0 ${displayWidth} ${displayHeight}"`,
    ' preserveAspectRatio="none">',
    `<image href="${sheetImage}" xlink:href="${sheetImage}" x="${x}" y="${y}"`,
    ` width="${sheetDisplayWidth}" height="${sheetDisplayHeight}"`,
    ' preserveAspectRatio="none" />',
    '</svg>',
  ].join('');

  return `${SVG_DATA_URL_PREFIX}${encodeURIComponent(svg)}`;
}

function createExternalImage(image: string): SpriteImage {
  return {
    height: 1,
    image,
    pixelRatio: 1,
    width: 1,
  };
}

function toDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return `data:image/png;base64,${toBase64(bytes)}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
