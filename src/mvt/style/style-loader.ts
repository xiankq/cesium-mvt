import type {
  BackgroundLayerSpecification,
  GeoJSONSourceSpecification,
  SourceSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { deepClone, resolveUrl } from '../utils/common';

export interface StyleSet {
  backgroundColor?: string;
  style: StyleSpecification;
  styleUrl?: string;
}

export function createStyleSet(
  style: StyleSpecification,
  styleUrl?: string,
): StyleSet {
  return {
    backgroundColor: extractBackgroundColor(style),
    style,
    styleUrl,
  };
}

function extractBackgroundColor(style: StyleSpecification) {
  for (const layer of style.layers) {
    if (layer.type !== 'background') {
      continue;
    }

    const backgroundLayer = layer as BackgroundLayerSpecification;
    const backgroundColor = backgroundLayer.paint?.['background-color'];
    if (typeof backgroundColor === 'string') {
      return backgroundColor;
    }
  }

  return undefined;
}

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
  return deepClone(style);
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
