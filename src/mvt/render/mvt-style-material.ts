import type { MvtBucketFeature, MvtCompiledStyleLayer } from '../mvt-types';
import type { MvtStyleSet } from '../style/mvt-style-set';
import { BufferPointMaterial, BufferPolygonMaterial, BufferPolylineMaterial } from '@cesium/engine';
import { resolveCircleStyleRule, resolveFillStyleRule, resolveLineStyleRule, serializeColor } from './mvt-style-rule';

export type MvtFeatureMaterial = BufferPointMaterial | BufferPolygonMaterial | BufferPolylineMaterial;
export type MvtFeatureMaterialCache = Map<string, MvtFeatureMaterial | undefined>;

export function createFeatureMaterial(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature?: MvtBucketFeature,
  materialCache?: MvtFeatureMaterialCache,
): MvtFeatureMaterial | undefined {
  switch (layer.type) {
    case 'fill':
      return createFillMaterial(styleSet, layer, zoom, feature, materialCache);
    case 'line':
      return createLineMaterial(styleSet, layer, zoom, feature, materialCache);
    case 'circle':
      return createCircleMaterial(styleSet, layer, zoom, feature, materialCache);
    case 'background':
    case 'symbol':
      return undefined;
  }
}

function createCircleMaterial(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature?: MvtBucketFeature,
  materialCache?: MvtFeatureMaterialCache,
): BufferPointMaterial | undefined {
  const styleRule = resolveCircleStyleRule(styleSet, layer, zoom, feature);
  if (!styleRule.visible || styleRule.size <= 0) {
    return undefined;
  }

  const materialKey = [
    layer.id,
    'circle',
    serializeColor(styleRule.fillColor),
    serializeColor(styleRule.outlineColor),
    Math.max(0, styleRule.outlineWidth),
    Math.max(1, styleRule.size),
  ].join(':');

  return getOrCreateMaterial(materialCache, materialKey, () => new BufferPointMaterial({
    color: styleRule.fillColor,
    outlineColor: styleRule.outlineColor,
    outlineWidth: Math.max(0, styleRule.outlineWidth),
    size: Math.max(1, styleRule.size),
  })) as BufferPointMaterial | undefined;
}

function createFillMaterial(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature?: MvtBucketFeature,
  materialCache?: MvtFeatureMaterialCache,
): BufferPolygonMaterial | undefined {
  const styleRule = resolveFillStyleRule(styleSet, layer, zoom, feature);
  if (!styleRule.visible) {
    return undefined;
  }

  const materialKey = [
    layer.id,
    'fill',
    serializeColor(styleRule.fillColor),
    serializeColor(styleRule.outlineColor),
    styleRule.outlineWidth,
  ].join(':');

  return getOrCreateMaterial(materialCache, materialKey, () => new BufferPolygonMaterial({
    color: styleRule.fillColor,
    outlineColor: styleRule.outlineColor,
    outlineWidth: styleRule.outlineWidth,
  })) as BufferPolygonMaterial | undefined;
}

function createLineMaterial(
  styleSet: MvtStyleSet,
  layer: MvtCompiledStyleLayer,
  zoom: number,
  feature?: MvtBucketFeature,
  materialCache?: MvtFeatureMaterialCache,
): BufferPolylineMaterial | undefined {
  const styleRule = resolveLineStyleRule(styleSet, layer, zoom, feature);
  if (!styleRule.visible || styleRule.width <= 0) {
    return undefined;
  }

  const normalizedWidth = Math.max(1, styleRule.width);
  const materialKey = [
    layer.id,
    'line',
    serializeColor(styleRule.color),
    serializeColor(styleRule.outlineColor),
    styleRule.outlineWidth,
    normalizedWidth,
  ].join(':');

  return getOrCreateMaterial(materialCache, materialKey, () => new BufferPolylineMaterial({
    color: styleRule.color,
    outlineColor: styleRule.outlineColor,
    outlineWidth: styleRule.outlineWidth,
    width: normalizedWidth,
  })) as BufferPolylineMaterial | undefined;
}

function getOrCreateMaterial(
  materialCache: MvtFeatureMaterialCache | undefined,
  materialKey: string,
  factory: () => MvtFeatureMaterial,
): MvtFeatureMaterial {
  if (!materialCache) {
    return factory();
  }

  if (materialCache.has(materialKey)) {
    return materialCache.get(materialKey)!;
  }

  const material = factory();
  materialCache.set(materialKey, material);
  return material;
}
