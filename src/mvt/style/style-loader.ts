import type {
  GeoJSONSourceSpecification,
  SourceSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleSet } from './style-set';
import { createStyleSet } from './style-set';

export interface LoadStyleSetOptions {
  style: string | StyleSpecification;
}

export function normalizeStyle(
  style: StyleSpecification,
  styleUrl?: string,
): StyleSet {
  const normalizedStyle = cloneStyle(style);

  if (styleUrl) {
    normalizeAssetUrls(normalizedStyle, styleUrl);
  }

  return createStyleSet(normalizedStyle, styleUrl);
}

export async function loadStyleSet(
  options: LoadStyleSetOptions,
): Promise<StyleSet> {
  const { style } = options;
  if (typeof style !== 'string') {
    return normalizeStyle(style);
  }

  const response = await fetch(style);
  if (!response.ok) {
    throw new Error(`Failed to load style: ${style}`);
  }

  const styleDefinition = await response.json() as StyleSpecification;
  return normalizeStyle(styleDefinition, style);
}

function cloneStyle(style: StyleSpecification): StyleSpecification {
  if (typeof structuredClone === 'function') {
    return structuredClone(style);
  }

  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}

function normalizeAssetUrls(style: StyleSpecification, styleUrl: string) {
  if (typeof style.sprite === 'string') {
    style.sprite = resolveUrl(style.sprite, styleUrl);
  }

  if (typeof style.glyphs === 'string') {
    style.glyphs = resolveUrl(style.glyphs, styleUrl);
  }

  for (const source of Object.values(style.sources)) {
    normalizeSource(source, styleUrl);
  }
}

function normalizeSource(source: SourceSpecification, styleUrl: string) {
  if ('url' in source && typeof source.url === 'string') {
    source.url = resolveUrl(source.url, styleUrl);
  }

  if ('tiles' in source && Array.isArray(source.tiles)) {
    source.tiles = source.tiles.map(tileUrl => resolveUrl(tileUrl, styleUrl));
  }

  const geojsonSource = source as GeoJSONSourceSpecification;
  if (source.type === 'geojson' && typeof geojsonSource.data === 'string') {
    geojsonSource.data = resolveUrl(geojsonSource.data, styleUrl);
  }
}

function resolveUrl(resourceUrl: string, styleUrl: string) {
  return new URL(resourceUrl, styleUrl)
    .toString()
    .replaceAll('%7B', '{')
    .replaceAll('%7D', '}');
}
