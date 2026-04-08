import type { Color } from '@cesium/engine';
import type {
  MvtBucketFeature,
  MvtCompiledStyleLayer,
  MvtStyleFamily,
  MvtStyleLayerSpecification,
  MvtStyleSourceSpecification,
  MvtStyleSpecification,
  MvtStyleSpriteAtlas,
  MvtStyleSpriteEntry,
} from '../mvt-types';
import type { MvtStyleExpressionCache } from './mvt-style-value';
import { isMvtDebugLoggingEnabled, logMvtWarning } from '../mvt-log';
import { buildMvtStyleFamilies, compileStyleLayer } from './mvt-style-family';
import {
  fetchTileJson,
  resolveStyleResourceUrl,
  resolveStyleResourceUrls,
  resolveStyleSpriteAtlas,
} from './mvt-style-resource';
import {
  evaluateLayerLayoutNumber,
  evaluateLayerLayoutValue,
  evaluateLayerPaintColor,
  evaluateLayerPaintNumber,
  evaluateLayerPaintValue,
} from './mvt-style-value';

export interface MvtStyleSetOptions {
  baseUrl?: string;
  source?: string;
}

export class MvtStyleSet {
  static fromSpecification(
    styleSpecification: MvtStyleSpecification,
    options: MvtStyleSetOptions = {},
  ): MvtStyleSet {
    warnUnsupportedLayers(styleSpecification);
    const sourceId = resolveVectorSourceId(styleSpecification, options.source);
    const source = sourceId
      ? resolveStyleSource(
          styleSpecification.sources[sourceId] as MvtStyleSourceSpecification,
          options.baseUrl,
        )
      : undefined;
    const spriteUrl = resolveStyleSpecificationSpriteUrl(styleSpecification.sprite, options.baseUrl);
    const supportedLayers = styleSpecification.layers.filter(isSupportedMvtStyleLayer);
    const compiledLayers = supportedLayers.map((styleLayer, order) => compileStyleLayer(styleLayer, order));
    const compiledLayerMap = new Map(compiledLayers.map(compiledLayer => [compiledLayer.id, compiledLayer]));
    const families = buildMvtStyleFamilies(supportedLayers, compiledLayerMap, sourceId);
    const backgroundLayers = compiledLayers.filter(layer => layer.type === 'background');

    return new MvtStyleSet(
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

  readonly backgroundLayers: readonly MvtCompiledStyleLayer[];
  readonly compiledLayers: readonly MvtCompiledStyleLayer[];
  readonly families: readonly MvtStyleFamily[];
  readonly source?: MvtStyleSourceSpecification;
  readonly sourceId?: string;
  readonly spriteAtlas?: MvtStyleSpriteAtlas;
  readonly spriteUrl?: string;
  readonly specification: MvtStyleSpecification;
  private readonly compiledLayerMap: ReadonlyMap<string, MvtCompiledStyleLayer>;
  private layoutExpressionCache: MvtStyleExpressionCache = new WeakMap();
  private paintExpressionCache: MvtStyleExpressionCache = new WeakMap();
  private visibleFamilyCache = new Map<number, MvtStyleFamily[]>();

  private constructor(
    specification: MvtStyleSpecification,
    sourceId: string | undefined,
    source: MvtStyleSourceSpecification | undefined,
    spriteUrl: string | undefined,
    spriteAtlas: MvtStyleSpriteAtlas | undefined,
    compiledLayers: readonly MvtCompiledStyleLayer[],
    compiledLayerMap: ReadonlyMap<string, MvtCompiledStyleLayer>,
    families: readonly MvtStyleFamily[],
    backgroundLayers: readonly MvtCompiledStyleLayer[],
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

  getVisibleFamilies(zoom: number): MvtStyleFamily[] {
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

  getCompiledLayer(layerId: string): MvtCompiledStyleLayer | undefined {
    return this.compiledLayerMap.get(layerId);
  }

  getSpriteEntry(spriteName: string): MvtStyleSpriteEntry | undefined {
    return this.spriteAtlas?.entries.get(spriteName);
  }

  evaluatePaintColor(
    layer: MvtCompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature: MvtBucketFeature | undefined,
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
    layer: MvtCompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature: MvtBucketFeature | undefined,
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
    layer: MvtCompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature?: MvtBucketFeature,
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
    layer: MvtCompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature: MvtBucketFeature | undefined,
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
    layer: MvtCompiledStyleLayer,
    propertyName: string,
    zoom: number,
    feature?: MvtBucketFeature,
  ): unknown {
    return evaluateLayerLayoutValue(
      this.layoutExpressionCache,
      layer,
      propertyName,
      zoom,
      feature,
    );
  }

  async resolveVectorSource(fetcher?: typeof fetch): Promise<MvtStyleSet> {
    if (!this.source?.url || this.source.tiles?.length) {
      return this;
    }

    const tileJson = await fetchTileJson(this.source.url, fetcher);
    return new MvtStyleSet(
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

  async resolveSpriteSource(fetcher?: typeof fetch): Promise<MvtStyleSet> {
    if (!this.spriteUrl || this.spriteAtlas) {
      return this;
    }

    const spriteAtlas = await resolveStyleSpriteAtlas(this.spriteUrl, fetcher);
    return new MvtStyleSet(
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
    styleLayer: MvtCompiledStyleLayer | MvtStyleLayerSpecification,
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

function warnUnsupportedLayers(styleSpecification: MvtStyleSpecification): void {
  const unsupportedLayers = styleSpecification.layers.filter(layer => !isSupportedMvtStyleLayer(layer));
  if (!unsupportedLayers.length) {
    return;
  }

  logMvtWarning(
    isMvtDebugLoggingEnabled(),
    `样式中存在 ${unsupportedLayers.length} 个当前未渲染的 layer type，已跳过。`,
    unsupportedLayers.map(layer => ({
      id: layer.id,
      type: layer.type,
    })),
  );
}

function resolveVectorSourceId(
  styleSpecification: MvtStyleSpecification,
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

function isSupportedMvtStyleLayer(layer: MvtStyleSpecification['layers'][number]): layer is MvtStyleLayerSpecification {
  return layer.type === 'background'
    || layer.type === 'fill'
    || layer.type === 'line'
    || layer.type === 'circle'
    || layer.type === 'symbol';
}

function resolveStyleSource(
  source: MvtStyleSourceSpecification,
  baseUrl?: string,
): MvtStyleSourceSpecification {
  return {
    ...source,
    tiles: resolveStyleResourceUrls(source.tiles, baseUrl),
    url: resolveStyleResourceUrl(source.url, baseUrl),
  };
}

function resolveStyleSpecificationSpriteUrl(
  sprite: MvtStyleSpecification['sprite'],
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
