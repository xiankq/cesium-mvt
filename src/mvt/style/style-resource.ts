import type { StyleSpriteAtlas, StyleSpriteEntry, TileJson } from '../types';
import { Resource } from '@cesium/engine';

interface PngSize {
  height: number;
  width: number;
}

export async function fetchStyleJsonResource<T>(
  resourceUrl: string,
  fetcher?: typeof fetch,
  errorPrefix = 'Failed to fetch MVT style resource',
): Promise<T> {
  if (fetcher) {
    const response = await fetcher(resourceUrl);
    if (!response.ok) {
      throw new Error(`${errorPrefix}: ${response.status} ${response.statusText}`);
    }

    return await response.json() as T;
  }

  const resource = new Resource({ url: resourceUrl });
  const resourceJson = resource.fetchJson();
  if (!resourceJson) {
    throw new Error(`Failed to schedule MVT style JSON request for "${resourceUrl}".`);
  }

  return await resourceJson as T;
}

export async function fetchStyleArrayBufferResource(
  resourceUrl: string,
  fetcher?: typeof fetch,
): Promise<ArrayBuffer> {
  if (fetcher) {
    const response = await fetcher(resourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch MVT style binary resource: ${response.status} ${response.statusText}`);
    }

    return await response.arrayBuffer();
  }

  const resource = new Resource({ url: resourceUrl });
  const arrayBuffer = resource.fetchArrayBuffer();
  if (!arrayBuffer) {
    throw new Error(`Failed to schedule MVT style binary request for "${resourceUrl}".`);
  }

  return await arrayBuffer;
}

export async function fetchTileJson(tileJsonUrl: string, fetcher?: typeof fetch): Promise<TileJson> {
  return await fetchStyleJsonResource<TileJson>(
    tileJsonUrl,
    fetcher,
    'Failed to fetch MVT TileJSON',
  );
}

export async function resolveStyleSpriteAtlas(
  spriteUrl: string | undefined,
  fetcher?: typeof fetch,
): Promise<StyleSpriteAtlas | undefined> {
  if (!spriteUrl) {
    return undefined;
  }

  const jsonUrl = `${spriteUrl}.json`;
  const imageUrl = `${spriteUrl}.png`;
  const [spriteIndex, spriteImageBuffer] = await Promise.all([
    fetchStyleJsonResource<Record<string, StyleSpriteEntry>>(
      jsonUrl,
      fetcher,
      'Failed to fetch MVT sprite index',
    ),
    fetchStyleArrayBufferResource(imageUrl, fetcher),
  ]);
  const imageSize = readPngSize(spriteImageBuffer);

  const image = await loadImageFromArrayBuffer(spriteImageBuffer);

  return {
    entries: new Map(Object.entries(spriteIndex)),
    image,
    imageHeight: imageSize.height,
    imageUrl,
    imageWidth: imageSize.width,
    jsonUrl,
  };
}

function loadImageFromArrayBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
  if (typeof Image === 'undefined') {
    return Promise.resolve({} as HTMLImageElement);
  }

  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load sprite image'));
    };
    image.src = url;
  });
}

export function resolveStyleResourceUrl(resourceUrl?: string, baseUrl?: string): string | undefined {
  if (!resourceUrl) {
    return undefined;
  }
  if (!baseUrl) {
    return resourceUrl;
  }

  const placeholderEntries: Array<[placeholder: string, token: string]> = [];
  const normalizedResourceUrl = resourceUrl.replaceAll(/\{[^}]+\}/g, (placeholder) => {
    const token = `__mvt_template_${placeholderEntries.length}__`;
    placeholderEntries.push([placeholder, token]);
    return token;
  });
  let resolvedUrl = new URL(normalizedResourceUrl, baseUrl).toString();
  for (const [placeholder, token] of placeholderEntries) {
    resolvedUrl = resolvedUrl.replaceAll(token, placeholder);
  }

  return resolvedUrl;
}

export function resolveStyleResourceUrls(resourceUrls?: readonly string[], baseUrl?: string): string[] | undefined {
  const resolvedUrls = resourceUrls
    ?.map(resourceUrl => resolveStyleResourceUrl(resourceUrl, baseUrl))
    .filter((resourceUrl): resourceUrl is string => Boolean(resourceUrl));

  return resolvedUrls?.length ? resolvedUrls : undefined;
}

function readPngSize(arrayBuffer: ArrayBuffer): PngSize {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 24) {
    throw new Error('Sprite PNG is too small to contain a valid IHDR chunk.');
  }

  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (const [index, value] of pngSignature.entries()) {
    if (bytes[index] !== value) {
      throw new Error('Sprite image is not a valid PNG file.');
    }
  }

  const dataView = new DataView(arrayBuffer);
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== 'IHDR') {
    throw new Error('Sprite PNG does not contain a valid IHDR chunk.');
  }

  return {
    height: dataView.getUint32(20),
    width: dataView.getUint32(16),
  };
}
