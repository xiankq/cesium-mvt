import type { MapLibreStyleDocument, MvtProviderOptions, MvtSourceOptions } from '../mvt';
import { Rectangle } from 'cesium';
import { normalizeMapLibreStyle, resolveMapLibreVectorSource, summarizeMapLibreStyle } from '../mvt';

interface RemoteTileJson {
  tilejson?: string;
  name?: string;
  tiles?: string[];
  minzoom?: number;
  maxzoom?: number;
  bounds?: number[];
  scheme?: string;
}

type OpenFreeMapEnv = ImportMetaEnv & {
  readonly VITE_MVT_URL_TEMPLATE?: string;
  readonly VITE_MVT_STYLE_URL?: string;
  readonly VITE_MVT_STYLE_SOURCE?: string;
  readonly VITE_MVT_SOURCE_ID?: string;
  readonly VITE_MVT_SUBDOMAINS?: string;
  readonly VITE_MVT_MIN_LEVEL?: string;
  readonly VITE_MVT_MAX_LEVEL?: string;
  readonly VITE_MVT_TILE_WIDTH?: string;
  readonly VITE_MVT_TILE_HEIGHT?: string;
  readonly VITE_MVT_MAX_CONCURRENT?: string;
  readonly VITE_MVT_CACHE_SIZE?: string;
};

export type OpenFreeMapMvtRuntimeMode = 'disabled' | 'template' | 'style';

export type OpenFreeMapMvtRuntimeConfig = MvtProviderOptions & {
  enabled: boolean;
  mode: OpenFreeMapMvtRuntimeMode;
  title: string;
  summary: string;
  detail: string;
  style?: MapLibreStyleDocument;
  sourceName?: string;
  sourceType?: string;
  styleUrl?: string;
  styleName?: string;
  styleLayerCount?: number;
  spriteUrl?: MapLibreStyleDocument['sprite'];
  glyphsUrl?: string;
  sourceUrl?: string;
  tilejsonUrl?: string;
};

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '')
    return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '')
    return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBounds(bounds: number[] | undefined): Rectangle | undefined {
  if (!bounds || bounds.length < 4)
    return undefined;

  const [west, south, east, north] = bounds;
  if (
    [west, south, east, north].some(value => typeof value !== 'number' || Number.isNaN(value))
  ) {
    return undefined;
  }

  return Rectangle.fromDegrees(west, south, east, north);
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function normalizeSubdomains(subdomains?: string): string | string[] | undefined {
  if (subdomains === undefined || subdomains.trim() === '')
    return undefined;
  return subdomains.trim();
}

function buildTemplateRuntimeConfig(
  env: OpenFreeMapEnv,
  urlTemplate: string,
): OpenFreeMapMvtRuntimeConfig {
  const sourceId = env.VITE_MVT_SOURCE_ID?.trim() || 'cesium-mvt';
  const minimumLevel = parseOptionalInteger(env.VITE_MVT_MIN_LEVEL);
  const maximumLevel = parseOptionalInteger(env.VITE_MVT_MAX_LEVEL);
  const maxConcurrentRequests = parseInteger(env.VITE_MVT_MAX_CONCURRENT, 4);
  const cacheSize = parseInteger(env.VITE_MVT_CACHE_SIZE, 64);

  const source: MvtSourceOptions = {
    id: sourceId,
    urlTemplate,
    subdomains: normalizeSubdomains(env.VITE_MVT_SUBDOMAINS),
    minimumLevel,
    maximumLevel,
    tileWidth: parseInteger(env.VITE_MVT_TILE_WIDTH, 256),
    tileHeight: parseInteger(env.VITE_MVT_TILE_HEIGHT, 256),
    hasAlphaChannel: true,
  };

  return {
    enabled: true,
    mode: 'template',
    title: sourceId,
    summary: 'Direct tile template',
    detail: urlTemplate,
    maxConcurrentRequests,
    cacheSize,
    source,
  };
}

async function buildStyleRuntimeConfig(
  env: OpenFreeMapEnv,
  styleUrl: string,
  signal?: AbortSignal,
): Promise<OpenFreeMapMvtRuntimeConfig> {
  const rawStyle = await fetchJson<MapLibreStyleDocument>(styleUrl, signal);
  const style = normalizeMapLibreStyle(rawStyle);
  const source = resolveMapLibreVectorSource(style, env.VITE_MVT_STYLE_SOURCE?.trim());
  const sourceMeta = source.url ? await fetchJson<RemoteTileJson>(source.url, signal) : source;
  const tiles = sourceMeta.tiles ?? source.tiles ?? [];

  if (tiles.length === 0) {
    throw new Error(`Style source "${source.name}" does not expose any tile templates.`);
  }

  const sourceId = env.VITE_MVT_SOURCE_ID?.trim() || `${style.name ?? 'style'}:${source.name}`;
  const minimumLevel
    = parseOptionalInteger(env.VITE_MVT_MIN_LEVEL)
      ?? sourceMeta.minzoom
      ?? source.minzoom
      ?? 0;
  const maximumLevel
    = parseOptionalInteger(env.VITE_MVT_MAX_LEVEL)
      ?? sourceMeta.maxzoom
      ?? source.maxzoom;
  const maxConcurrentRequests = parseInteger(env.VITE_MVT_MAX_CONCURRENT, 4);
  const cacheSize = parseInteger(env.VITE_MVT_CACHE_SIZE, 64);

  const sourceOptions: MvtSourceOptions = {
    id: sourceId,
    urlTemplate: tiles[0],
    subdomains: normalizeSubdomains(env.VITE_MVT_SUBDOMAINS),
    minimumLevel,
    maximumLevel,
    rectangle: parseBounds(sourceMeta.bounds ?? source.bounds),
    tileWidth: parseInteger(env.VITE_MVT_TILE_WIDTH, 256),
    tileHeight: parseInteger(env.VITE_MVT_TILE_HEIGHT, 256),
    hasAlphaChannel: true,
  };

  const styleSummary = summarizeMapLibreStyle(style);
  const title = styleSummary.title;
  const summary = `${title} · ${source.name} · ${styleSummary.layerCount} layers`;
  const detail = source.url
    ? `Style ${styleUrl} · TileJSON ${source.url}`
    : `Style ${styleUrl} · inline tiles`;

  return {
    enabled: true,
    mode: 'style',
    title,
    summary,
    detail,
    style,
    maxConcurrentRequests,
    cacheSize,
    source: sourceOptions,
    sourceName: source.name,
    sourceType: source.source.type,
    styleUrl,
    styleName: styleSummary.title,
    styleLayerCount: styleSummary.layerCount,
    spriteUrl: styleSummary.spriteUrl,
    glyphsUrl: styleSummary.glyphsUrl,
    sourceUrl: source.url,
    tilejsonUrl: source.url,
  };
}

export async function resolveOpenFreeMapMvtRuntimeConfigFromEnv(
  signal?: AbortSignal,
): Promise<OpenFreeMapMvtRuntimeConfig> {
  const env = import.meta.env as OpenFreeMapEnv;
  const directTemplate = env.VITE_MVT_URL_TEMPLATE?.trim();

  if (directTemplate) {
    return buildTemplateRuntimeConfig(env, directTemplate);
  }

  const styleUrl = env.VITE_MVT_STYLE_URL?.trim() || DEFAULT_STYLE_URL;
  if (!styleUrl) {
    return {
      enabled: false,
      mode: 'disabled',
      title: 'MVT runtime',
      summary: 'Disabled',
      detail: 'No tile template or style URL was configured.',
      source: {
        id: env.VITE_MVT_SOURCE_ID?.trim() || 'cesium-mvt',
        urlTemplate: '',
        hasAlphaChannel: true,
      },
    };
  }

  return buildStyleRuntimeConfig(env, styleUrl, signal);
}
