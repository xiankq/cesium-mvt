import type {
  GeoJSONSourceSpecification,
  SourceSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { SpriteAtlas } from './sprite-atlas';
import { Resource } from 'cesium';
import { deepClone, resolveUrl } from '../utils/common';
import { loadSpriteAtlas } from './sprite-atlas';

export interface StyleSet {
  style: StyleSpecification & {
    spriteAtlas?: SpriteAtlas;
  };
}

export interface LoadStyleSetOptions {
  style: string | URL | Resource | StyleSpecification;
}

export function normalizeStyle(
  style: StyleSpecification,
  styleUrl?: string,
): StyleSet {
  const normalizedStyle = deepClone(style);

  if (styleUrl) {
    normalizeAssetUrls(normalizedStyle, styleUrl);
  }

  return {
    style: normalizedStyle,
  };
}

export async function loadStyleSet(
  options: LoadStyleSetOptions,
): Promise<StyleSet> {
  const { style } = options;
  if (typeof style !== 'string' && !(style instanceof URL) && !(style instanceof Resource)) {
    const styleSet = normalizeStyle(style);
    if (typeof styleSet.style.sprite === 'string') {
      styleSet.style.spriteAtlas = await loadSpriteAtlas(styleSet.style.sprite);
    }
    return styleSet;
  }

  if (style instanceof Resource) {
    const styleDefinition = await style.fetchJson();
    if (!styleDefinition) {
      throw new Error(`Failed to load style: ${style.url}`);
    }

    const styleSet = normalizeStyle(
      styleDefinition as StyleSpecification,
      style.getBaseUri(),
    );

    if (typeof styleSet.style.sprite === 'string') {
      styleSet.style.spriteAtlas = await loadSpriteAtlas(styleSet.style.sprite);
    }

    return styleSet;
  }

  const styleUrl = style.toString();
  const response = await fetch(styleUrl);
  if (!response.ok) {
    throw new Error(`Failed to load style: ${styleUrl}`);
  }

  const styleDefinition = await response.json() as StyleSpecification;
  const styleSet = normalizeStyle(styleDefinition, styleUrl);

  if (typeof styleSet.style.sprite === 'string') {
    styleSet.style.spriteAtlas = await loadSpriteAtlas(styleSet.style.sprite);
  }

  return styleSet;
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
    // GeoJSON 的 data URL 和其他样式资源一样，也需要尽早解析成绝对地址。
    geojsonSource.data = resolveUrl(geojsonSource.data, styleUrl);
  }
}
