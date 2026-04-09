import type { Color } from '@cesium/engine';
import type { CompositeSpriteCache } from '../render/symbol-composite';
import type { BucketFeature, CompiledStyleLayer, StyleFamily, StyleLayerSpecification, StyleSourceSpecification, StyleSpecification, StyleSpriteAtlas, StyleSpriteEntry } from '../types';
import type { StyleExpressionCache } from './style-value';
import { isDebugLoggingEnabled, logWarning } from '../log';
import { createCompositeSpriteCache } from '../render/symbol-composite';
import { buildStyleFamilies, compileStyleLayer } from './style-family';
import { fetchTileJson, resolveStyleResourceUrl, resolveStyleResourceUrls, resolveStyleSpriteAtlas } from './style-resource';
import { evaluateLayerLayoutNumber, evaluateLayerLayoutValue, evaluateLayerPaintColor, evaluateLayerPaintNumber, evaluateLayerPaintValue } from './style-value';

export interface StyleSetOptions {
  baseUrl?: string;
  source?: string;
}

export class StyleSet {
  static fromSpecification(
    styleSpecification: StyleSpecification,
    options: StyleSetOptions = {},
  ): StyleSet {
    warnUnsupportedLayers(styleSpecification);
    const sourceId = resolveVectorSourceId(styleSpecification, options.source);
    const source = sourceId
      ? resolveStyleSource(
          styleSpecification.sources[sourceId] as StyleSourceSpecification,
          options.baseUrl,
        )
      : undefined;
    const spriteUrl = resolveStyleSpecificationSpriteUrl(styleSpecification.sprite, options.baseUrl);
    const supportedLayers = styleSpecification.layers.filter(isSupportedStyleLayer);
    const compiledLayers = supportedLayers.map((styleLayer, order) => compileStyleLayer(styleLayer, order));
    const compiledLayerMap = new Map(compiledLayers.map(compiledLayer => [compiledLayer.id, compiledLayer]));
    const families = buildStyleFamilies(supportedLayers, compiledLayerMap, sourceId);
    const backgroundLayers = compiledLayers.filter(layer => layer.type === 'background');

    return new StyleSet(
      styleSpecification,
      sourceId,
      source,
      spriteUrl,
      undefined,
      compiledLayers,
      compiledLayerMap,
      families,
      backgroundLayers,
    );
  }

  readonly backgroundLayers: readonly CompiledStyleLayer[];
  readonly compiledLayers: readonly CompiledStyleLayer[];
  readonly compositeSpriteCache: CompositeSpriteCache;
  readonly families: readonly StyleFamily[];
  readonly source?: StyleSourceSpecification;
  readonly sourceId?: string;
  readonly spriteAtlas?: StyleSpriteAtlas;
  readonly spriteUrl?: string;
  readonly specification: StyleSpecification;
  private readonly compiledLayerMap: ReadonlyMap<string, CompiledStyleLayer>;
  private layoutExpressionCache: StyleExpressionCache = new WeakMap();
  private paintExpressionCache: StyleExpressionCache = new WeakMap();
  private visibleFamilyCache = new Map<number, StyleFamily[]>();

  private constructor(
    specification: StyleSpecification,
    sourceId: string | undefined,
    source: StyleSourceSpecification | undefined,
    spriteUrl: string | undefined,
    spriteAtlas: StyleSpriteAtlas | undefined,
    compiledLayers: readonly CompiledStyleLayer[],
    compiledLayerMap: ReadonlyMap<string, CompiledStyleLayer>,
    families: readonly StyleFamily[],
    backgroundLayers: readonly CompiledStyleLayer[],
  ) {
    this.specification = specification;
    this.sourceId = sourceId;
    this.source = source;
    this.spriteUrl = spriteUrl;
    this.spriteAtlas = spriteAtlas;
    this.compiledLayers = compiledLayers;
    this.compiledLayerMap = compiledLayerMap;
    this.families = families;
    this.backgroundLayers = backgroundLayers;
    this.compositeSpriteCache = createCompositeSpriteCache();
  }

  get backgroundColor(): string | undefined {
    let backgroundColor: string | undefined;
    for (const layer of this.backgroundLayers) {
      if (!this.isLayerVisibleAtZoom(layer, Number.NEGATIVE_INFINITY)) {
        continue;
      }
      const candidateColor = layer.paint['background-color'];
      const candidateOpacity = layer.paint['background-opacity'];
      if (typeof candidateOpacity === 'number' && candidateOpacity <= 0) {
        continue;
      }
      if (typeof candidateColor === 'string') {
        backgroundColor = candidateColor;
      }
    }
    return backgroundColor;
  }

  getVisibleFamilies(zoom: number): StyleFamily[] {
    const cachedFamilies = this.visibleFamilyCache.get(zoom);
    if (cachedFamilies) {
      return cachedFamilies;
    }

    const visibleFamilies = this.families.filter((family) => {
      return family.layers.some(layer => this.isLayerVisibleAtZoom(layer, zoom));
    });
    this.visibleFamilyCache.set(zoom, visibleFamilies);
    return visibleFamilies;
  }

  clearRuntimeCaches(): void {
    this.layoutExpressionCache = new WeakMap();
    this.paintExpressionCache = new WeakMap();
    this.visibleFamilyCache.clear();
  }

  getCompiledLayer(layerId: string): CompiledStyleLayer | undefined {
    return this.compiledLayerMap.get(layerId);
  }

  getSpriteEntry(spriteName: string): StyleSpriteEntry | undefined {
    return this.spriteAtlas?.entries.get(spriteName);
  }

  evaluatePaintColor(
    layer: CompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature: BucketFeature | undefined,
    fallbackColor: Color,
  ): Color {
    return evaluateLayerPaintColor(
      this.paintExpressionCache,
      layer,
      propertyName,
      zoom,
      feature,
      fallbackColor,
    );
  }

  evaluatePaintNumber(
    layer: CompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature: BucketFeature | undefined,
    fallbackValue: number,
  ): number {
    return evaluateLayerPaintNumber(
      this.paintExpressionCache,
      layer,
      propertyName,
      zoom,
      feature,
      fallbackValue,
    );
  }

  evaluatePaintValue(
    layer: CompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature?: BucketFeature,
  ): unknown {
    return evaluateLayerPaintValue(
      this.paintExpressionCache,
      layer,
      propertyName,
      zoom,
      feature,
    );
  }

  evaluateLayoutNumber(
    layer: CompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature: BucketFeature | undefined,
    fallbackValue: number,
  ): number {
    return evaluateLayerLayoutNumber(
      this.layoutExpressionCache,
      layer,
      propertyName,
      zoom,
      feature,
      fallbackValue,
    );
  }

  evaluateLayoutValue(
    layer: CompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature?: BucketFeature,
  ): unknown {
    return evaluateLayerLayoutValue(
      this.layoutExpressionCache,
      layer,
      propertyName,
      zoom,
      feature,
    );
  }

  async resolveVectorSource(fetcher?: typeof fetch): Promise<StyleSet> {
    if (!this.source?.url || this.source.tiles?.length) {
      return this;
    }

    const tileJson = await fetchTileJson(this.source.url, fetcher);
    return new StyleSet(
      this.specification,
      this.sourceId,
      {
        ...this.source,
        maxzoom: tileJson.maxzoom ?? this.source.maxzoom,
        minzoom: tileJson.minzoom ?? this.source.minzoom,
        tiles: resolveStyleResourceUrls(tileJson.tiles, this.source.url),
      },
      this.spriteUrl,
      this.spriteAtlas,
      this.compiledLayers,
      this.compiledLayerMap,
      this.families,
      this.backgroundLayers,
    );
  }

  async resolveSpriteSource(fetcher?: typeof fetch): Promise<StyleSet> {
    if (!this.spriteUrl || this.spriteAtlas) {
      return this;
    }

    const spriteAtlas = await resolveStyleSpriteAtlas(this.spriteUrl, fetcher);
    return new StyleSet(
      this.specification,
      this.sourceId,
      this.source,
      this.spriteUrl,
      spriteAtlas,
      this.compiledLayers,
      this.compiledLayerMap,
      this.families,
      this.backgroundLayers,
    );
  }

  getSourceTileTemplate(): string | undefined {
    return this.source?.tiles?.[0];
  }

  isLayerVisibleAtZoom(
    styleLayer: CompiledStyleLayer | StyleLayerSpecification,
    zoom: number,
  ): boolean {
    const minzoom = styleLayer.minzoom ?? Number.NEGATIVE_INFINITY;
    const maxzoom = styleLayer.maxzoom ?? Number.POSITIVE_INFINITY;
    if (zoom < minzoom || zoom >= maxzoom) {
      return false;
    }

    const layout = 'layout' in styleLayer && styleLayer.layout ? styleLayer.layout : {};
    return layout.visibility !== 'none';
  }
}

function warnUnsupportedLayers(styleSpecification: StyleSpecification): void {
  const unsupportedLayers = styleSpecification.layers.filter(layer => !isSupportedStyleLayer(layer));
  if (!unsupportedLayers.length) {
    return;
  }

  logWarning(
    isDebugLoggingEnabled(),
    `样式中存在 ${unsupportedLayers.length} 个当前未渲染的 layer type，已跳过。`,
    unsupportedLayers.map(layer => ({
      id: layer.id,
      type: layer.type,
    })),
  );
}

function resolveVectorSourceId(
  styleSpecification: StyleSpecification,
  sourceId?: string,
): string | undefined {
  if (sourceId) {
    const source = styleSpecification.sources[sourceId];
    if (!source) {
      throw new Error(`MVT style source "${sourceId}" does not exist.`);
    }
    if (source.type !== 'vector') {
      throw new Error(`MVT style source "${sourceId}" is not a vector source.`);
    }
    return sourceId;
  }

  const vectorSourceIds = Object.entries(styleSpecification.sources)
    .filter(([, source]) => source.type === 'vector')
    .map(([currentSourceId]) => currentSourceId);

  if (vectorSourceIds.length === 0) {
    return undefined;
  }
  if (vectorSourceIds.length > 1) {
    throw new Error('MVT style contains multiple vector sources. Please specify one explicitly.');
  }
  return vectorSourceIds[0];
}

function isSupportedStyleLayer(layer: StyleSpecification['layers'][number]): layer is StyleLayerSpecification {
  return layer.type === 'background'
    || layer.type === 'fill'
    || layer.type === 'line'
    || layer.type === 'circle'
    || layer.type === 'symbol';
}

function resolveStyleSource(
  source: StyleSourceSpecification,
  baseUrl?: string,
): StyleSourceSpecification {
  return {
    ...source,
    tiles: resolveStyleResourceUrls(source.tiles, baseUrl),
    url: resolveStyleResourceUrl(source.url, baseUrl),
  };
}

function resolveStyleSpecificationSpriteUrl(
  sprite: StyleSpecification['sprite'],
  baseUrl?: string,
): string | undefined {
  if (typeof sprite === 'string') {
    return resolveStyleResourceUrl(sprite, baseUrl);
  }
  if (!Array.isArray(sprite) || sprite.length === 0) {
    return undefined;
  }

  const defaultSprite = sprite.find(currentSprite => currentSprite.id === 'default') ?? sprite[0];
  return resolveStyleResourceUrl(defaultSprite?.url, baseUrl);
}
