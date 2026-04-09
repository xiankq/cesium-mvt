import type { StyleSet } from '../style/style-set';
import type { BucketFeature, CompiledStyleLayer } from '../types';
import { Color } from '@cesium/engine';

export interface CircleStyleRule {
  fillColor: Color;
  outlineColor: Color;
  outlineWidth: number;
  size: number;
  translate: [number, number];
  visible: boolean;
}

export interface FillStyleRule {
  antialias: boolean;
  fillColor: Color;
  outlineColor: Color;
  outlineWidth: number;
  translate: [number, number];
  visible: boolean;
}

export interface LineStyleRule {
  cap: 'butt' | 'round' | 'square';
  color: Color;
  dashArray?: number[];
  gapWidth: number;
  join: 'bevel' | 'miter' | 'round';
  offset: number;
  outlineColor: Color;
  outlineWidth: number;
  translate: [number, number];
  width: number;
  visible: boolean;
}

export function resolveCircleStyleRule(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature?: BucketFeature,
): CircleStyleRule {
  const fillColor = styleSet.evaluatePaintColor(layer, 'circle-color', zoom, feature, Color.WHITE);
  const fillOpacity = styleSet.evaluatePaintNumber(layer, 'circle-opacity', zoom, feature, 1);
  const strokeColor = styleSet.evaluatePaintColor(layer, 'circle-stroke-color', zoom, feature, Color.BLACK);
  const strokeOpacity = styleSet.evaluatePaintNumber(layer, 'circle-stroke-opacity', zoom, feature, 1);
  const strokeWidth = Math.max(0, styleSet.evaluatePaintNumber(layer, 'circle-stroke-width', zoom, feature, 0));
  const radius = Math.max(0, styleSet.evaluatePaintNumber(layer, 'circle-radius', zoom, feature, 5));
  const size = radius * 2;
  const fill = multiplyAlpha(fillColor, fillOpacity);
  const outline = multiplyAlpha(strokeColor, strokeOpacity);
  const translate = resolveNumberPair(
    styleSet.evaluatePaintValue(layer, 'circle-translate', zoom, feature),
    [0, 0],
  );

  return {
    fillColor: fill,
    outlineColor: outline,
    outlineWidth: strokeWidth,
    size,
    translate,
    visible: size > 0 && isVisible(fill.alpha, outline.alpha, strokeWidth),
  };
}

export function resolveFillStyleRule(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature?: BucketFeature,
): FillStyleRule {
  const fillColor = styleSet.evaluatePaintColor(layer, 'fill-color', zoom, feature, Color.BLACK);
  const fillOpacity = styleSet.evaluatePaintNumber(layer, 'fill-opacity', zoom, feature, 1);
  const antialias = resolveBoolean(styleSet.evaluatePaintValue(layer, 'fill-antialias', zoom, feature), true);
  const outlineFallback = Color.clone(fillColor);
  const outlineColor = layer.paint['fill-outline-color'] === undefined
    ? outlineFallback
    : styleSet.evaluatePaintColor(layer, 'fill-outline-color', zoom, feature, outlineFallback);
  const fill = multiplyAlpha(fillColor, fillOpacity);
  const outline = multiplyAlpha(outlineColor, fillOpacity);
  const translate = resolveNumberPair(
    styleSet.evaluatePaintValue(layer, 'fill-translate', zoom, feature),
    [0, 0],
  );
  const outlineWidth = antialias ? 1 : 0;

  return {
    antialias,
    fillColor: fill,
    outlineColor: outline,
    outlineWidth,
    translate,
    visible: isVisible(fill.alpha, outline.alpha, outlineWidth),
  };
}

export function resolveLineStyleRule(
  styleSet: StyleSet,
  layer: CompiledStyleLayer,
  zoom: number,
  feature?: BucketFeature,
): LineStyleRule {
  const lineColor = styleSet.evaluatePaintColor(layer, 'line-color', zoom, feature, Color.BLACK);
  const lineOpacity = styleSet.evaluatePaintNumber(layer, 'line-opacity', zoom, feature, 1);
  const width = Math.max(0, styleSet.evaluatePaintNumber(layer, 'line-width', zoom, feature, 1));
  const gapWidth = Math.max(0, styleSet.evaluatePaintNumber(layer, 'line-gap-width', zoom, feature, 0));
  const dashArray = resolveNumberArray(styleSet.evaluatePaintValue(layer, 'line-dasharray', zoom, feature));
  const fill = multiplyAlpha(lineColor, lineOpacity);
  const lineCap = normalizeLineCap(styleSet.evaluateLayoutValue(layer, 'line-cap', zoom, feature));
  const lineJoin = normalizeLineJoin(styleSet.evaluateLayoutValue(layer, 'line-join', zoom, feature));
  const offset = styleSet.evaluatePaintNumber(layer, 'line-offset', zoom, feature, 0);
  const translate = resolveNumberPair(
    styleSet.evaluatePaintValue(layer, 'line-translate', zoom, feature),
    [0, 0],
  );
  const hasGap = gapWidth > 0;

  return {
    cap: lineCap,
    color: hasGap ? Color.TRANSPARENT : fill,
    dashArray,
    gapWidth,
    join: lineJoin,
    offset,
    outlineColor: hasGap ? fill : Color.WHITE,
    outlineWidth: hasGap ? width : 0,
    translate,
    visible: (width > 0 || gapWidth > 0) && fill.alpha > 0,
    width: hasGap ? gapWidth : width,
  };
}

export function serializeColor(color: Color): string {
  return [
    color.red.toFixed(6),
    color.green.toFixed(6),
    color.blue.toFixed(6),
    color.alpha.toFixed(6),
  ].join(',');
}

function isVisible(fillAlpha: number, outlineAlpha: number, outlineWidth: number): boolean {
  return fillAlpha > 0 || (outlineAlpha > 0 && outlineWidth > 0);
}

function multiplyAlpha(color: Color, opacity: number): Color {
  const alpha = Math.max(0, Math.min(1, opacity));
  return new Color(color.red, color.green, color.blue, color.alpha * alpha);
}

function normalizeLineCap(value: unknown): LineStyleRule['cap'] {
  return value === 'butt' || value === 'square' ? value : 'round';
}

function normalizeLineJoin(value: unknown): LineStyleRule['join'] {
  return value === 'bevel' || value === 'miter' ? value : 'round';
}

function resolveBoolean(value: unknown, fallbackValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallbackValue;
}

function resolveNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value
    .map((item) => {
      return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
    })
    .filter((item): item is number => item !== undefined && item > 0);
  return numbers.length ? numbers : undefined;
}

function resolveNumberPair(
  value: unknown,
  fallbackValue: [number, number],
): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    return fallbackValue;
  }

  const x = typeof value[0] === 'number' && Number.isFinite(value[0]) ? value[0] : fallbackValue[0];
  const y = typeof value[1] === 'number' && Number.isFinite(value[1]) ? value[1] : fallbackValue[1];
  return [x, y];
}
