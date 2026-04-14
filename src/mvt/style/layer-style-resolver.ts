import type {
  CircleLayerSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  Formatted,
  LineLayerSpecification,
  ResolvedImage,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertyContext } from './style-property-evaluator';
import {
  createBooleanPropertyEvaluator,
  createColorPropertyEvaluator,
  createFormattedPropertyEvaluator,
  createNumberArrayPropertyEvaluator,
  createNumberPropertyEvaluator,
  createResolvedImagePropertyEvaluator,
  createStringArrayPropertyEvaluator,
  createStringPropertyEvaluator,
} from './style-property-evaluator';

export type LayerStyleContext = StylePropertyContext;

export interface CircleLayerStyle {
  color: string;
  opacity: number;
  radius: number;
}

export interface LineLayerStyle {
  color: string;
  dashArray?: number[];
  opacity: number;
  pattern?: string;
  width: number;
}

export interface FillLayerStyle {
  color: string;
  opacity: number;
  outlineColor?: string;
  pattern?: string;
}

export interface FillExtrusionLayerStyle {
  base: number;
  color: string;
  height: number;
  opacity: number;
  pattern?: string;
  verticalGradient: boolean;
}

export interface SymbolLayerStyle {
  sortKey?: number;
  sortKeyIsConstant?: boolean;
  zOrder: 'auto' | 'source' | 'viewport-y';
  symbolPlacement?: 'point' | 'line' | 'line-center';
  symbolSpacing?: number;
  symbolAvoidEdges?: boolean;
  textOptional?: boolean;
  textJustify?: 'auto' | 'left' | 'center' | 'right';
  textTransform?: 'none' | 'uppercase' | 'lowercase';

  // 文本属性
  textField?: string | Formatted;
  textFont?: string[];
  textSize?: number;
  textColor?: string;
  textOpacity?: number;
  textHaloBlur?: number;
  textHaloColor?: string;
  textHaloWidth?: number;
  textTranslate?: [number, number];
  textTranslateAnchor?: 'map' | 'viewport';
  textLineHeight?: number;
  textLetterSpacing?: number;
  textMaxWidth?: number;
  textRadialOffset?: number;
  textVariableAnchor?: Array<'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>;
  textVariableAnchorOffset?: Array<'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | [number, number]>;
  textMaxAngle?: number;
  textWritingMode?: Array<'horizontal' | 'vertical'>;
  textRotate?: number;
  textPadding?: number;
  textOffset?: [number, number];
  textAnchor?: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  textAllowOverlap?: boolean;
  textOverlap?: 'never' | 'always' | 'cooperative';
  textIgnorePlacement?: boolean;
  textRotationAlignment?: 'map' | 'viewport' | 'auto';
  textPitchAlignment?: 'map' | 'viewport' | 'auto';
  textKeepUpright?: boolean;

  // 图标属性
  iconImage?: string | ResolvedImage;
  iconOptional?: boolean;
  iconTextFit?: 'none' | 'width' | 'height' | 'both';
  iconTextFitPadding?: [number, number, number, number];
  iconRotate?: number;
  iconPadding?: number;
  iconAllowOverlap?: boolean;
  iconOverlap?: 'never' | 'always' | 'cooperative';
  iconIgnorePlacement?: boolean;
  iconRotationAlignment?: 'map' | 'viewport' | 'auto';
  iconPitchAlignment?: 'map' | 'viewport' | 'auto';
  iconKeepUpright?: boolean;
  iconTranslate?: [number, number];
  iconTranslateAnchor?: 'map' | 'viewport';
  iconSize?: number;
  iconColor?: string;
  iconOpacity?: number;
  iconOffset?: [number, number];
  iconAnchor?: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

const DEFAULT_CIRCLE_COLOR = '#000000';
const DEFAULT_CIRCLE_RADIUS = 5;
const DEFAULT_CIRCLE_OPACITY = 1;

const DEFAULT_LINE_COLOR = '#000000';
const DEFAULT_LINE_WIDTH = 1;
const DEFAULT_LINE_OPACITY = 1;

const DEFAULT_FILL_COLOR = '#000000';
const DEFAULT_FILL_OPACITY = 1;

export function createCircleLayerStyleResolver(
  layer: CircleLayerSpecification,
): (context: LayerStyleContext) => CircleLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createColorPropertyEvaluator(
    paint['circle-color'] ?? DEFAULT_CIRCLE_COLOR,
    DEFAULT_CIRCLE_COLOR,
  );

  const radiusEvaluator = createNumberPropertyEvaluator(
    paint['circle-radius'] ?? DEFAULT_CIRCLE_RADIUS,
    DEFAULT_CIRCLE_RADIUS,
  );

  const opacityEvaluator = createNumberPropertyEvaluator(
    paint['circle-opacity'] ?? DEFAULT_CIRCLE_OPACITY,
    DEFAULT_CIRCLE_OPACITY,
  );

  return (context: LayerStyleContext): CircleLayerStyle => ({
    color: colorEvaluator(context),
    opacity: opacityEvaluator(context),
    radius: radiusEvaluator(context),
  });
}

export function createLineLayerStyleResolver(
  layer: LineLayerSpecification,
): (context: LayerStyleContext) => LineLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createColorPropertyEvaluator(
    paint['line-color'] ?? DEFAULT_LINE_COLOR,
    DEFAULT_LINE_COLOR,
  );

  const dashArrayEvaluator = paint['line-dasharray']
    ? createNumberArrayPropertyEvaluator(paint['line-dasharray'])
    : undefined;

  const patternEvaluator = paint['line-pattern'] !== undefined
    ? createStringPropertyEvaluator(paint['line-pattern'], '')
    : undefined;

  const widthEvaluator = createNumberPropertyEvaluator(
    paint['line-width'] ?? DEFAULT_LINE_WIDTH,
    DEFAULT_LINE_WIDTH,
  );

  const opacityEvaluator = createNumberPropertyEvaluator(
    paint['line-opacity'] ?? DEFAULT_LINE_OPACITY,
    DEFAULT_LINE_OPACITY,
  );

  return (context: LayerStyleContext): LineLayerStyle => ({
    color: colorEvaluator(context),
    dashArray: dashArrayEvaluator?.(context),
    opacity: opacityEvaluator(context),
    pattern: patternEvaluator?.(context) || undefined,
    width: widthEvaluator(context),
  });
}

export function createFillLayerStyleResolver(
  layer: FillLayerSpecification,
): (context: LayerStyleContext) => FillLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createColorPropertyEvaluator(
    paint['fill-color'] ?? DEFAULT_FILL_COLOR,
    DEFAULT_FILL_COLOR,
  );

  const opacityEvaluator = createNumberPropertyEvaluator(
    paint['fill-opacity'] ?? DEFAULT_FILL_OPACITY,
    DEFAULT_FILL_OPACITY,
  );

  const outlineColorEvaluator = paint['fill-outline-color']
    ? createColorPropertyEvaluator(
        paint['fill-outline-color'],
        DEFAULT_FILL_COLOR,
      )
    : undefined;

  const patternEvaluator = paint['fill-pattern'] !== undefined
    ? createStringPropertyEvaluator(paint['fill-pattern'], '')
    : undefined;

  return (context: LayerStyleContext): FillLayerStyle => ({
    color: colorEvaluator(context),
    opacity: opacityEvaluator(context),
    outlineColor: outlineColorEvaluator?.(context),
    pattern: patternEvaluator?.(context) || undefined,
  });
}

const DEFAULT_TEXT_SIZE = 16;
const DEFAULT_TEXT_COLOR = '#000000';
const DEFAULT_TEXT_OPACITY = 1;
const DEFAULT_TEXT_HALO_COLOR = 'rgba(0, 0, 0, 0)';
const DEFAULT_TEXT_HALO_WIDTH = 0;
const DEFAULT_TEXT_HALO_BLUR = 0;
const DEFAULT_TEXT_JUSTIFY = 'center';
const DEFAULT_TEXT_TRANSFORM = 'none';
const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
const DEFAULT_TEXT_LETTER_SPACING = 0;
const DEFAULT_TEXT_MAX_WIDTH = 10;
const DEFAULT_TEXT_RADIAL_OFFSET = 0;
const DEFAULT_TEXT_MAX_ANGLE = 45;
const DEFAULT_TEXT_PADDING = 2;

const DEFAULT_ICON_SIZE = 1;
const DEFAULT_ICON_OPACITY = 1;
const DEFAULT_ICON_TEXT_FIT = 'none';
const DEFAULT_ICON_PADDING = 2;
const DEFAULT_SYMBOL_SPACING = 250;

export function createSymbolLayerStyleResolver(
  layer: SymbolLayerSpecification,
): (context: LayerStyleContext) => SymbolLayerStyle {
  const paint = layer.paint ?? {};
  const layout = layer.layout ?? {};

  const textFieldEvaluator = layout['text-field'] !== undefined
    ? createFormattedPropertyEvaluator(layout['text-field'])
    : undefined;

  const textFontEvaluator = layout['text-font'] !== undefined
    ? createStringArrayPropertyEvaluator(layout['text-font'])
    : undefined;

  const sortKeyEvaluator = layout['symbol-sort-key'] !== undefined
    ? createNumberPropertyEvaluator(layout['symbol-sort-key'], 0)
    : undefined;

  const zOrderEvaluator = createStringPropertyEvaluator(
    layout['symbol-z-order'] ?? 'auto',
    'auto',
  );

  const symbolPlacementEvaluator = layout['symbol-placement'] !== undefined
    ? createStringPropertyEvaluator(layout['symbol-placement'], 'point')
    : undefined;

  const symbolSpacingEvaluator = layout['symbol-spacing'] !== undefined
    ? createNumberPropertyEvaluator(layout['symbol-spacing'], DEFAULT_SYMBOL_SPACING)
    : undefined;

  const symbolAvoidEdgesEvaluator = layout['symbol-avoid-edges'] !== undefined
    ? createBooleanPropertyEvaluator(layout['symbol-avoid-edges'], false)
    : undefined;

  const textSizeEvaluator = createNumberPropertyEvaluator(
    layout['text-size'] ?? DEFAULT_TEXT_SIZE,
    DEFAULT_TEXT_SIZE,
  );

  const textColorEvaluator = createColorPropertyEvaluator(
    paint['text-color'] ?? DEFAULT_TEXT_COLOR,
    DEFAULT_TEXT_COLOR,
  );

  const textOpacityEvaluator = createNumberPropertyEvaluator(
    paint['text-opacity'] ?? DEFAULT_TEXT_OPACITY,
    DEFAULT_TEXT_OPACITY,
  );

  const textHaloColorEvaluator = paint['text-halo-color'] !== undefined
    ? createColorPropertyEvaluator(paint['text-halo-color'], DEFAULT_TEXT_HALO_COLOR)
    : undefined;

  const textHaloWidthEvaluator = paint['text-halo-width'] !== undefined
    ? createNumberPropertyEvaluator(paint['text-halo-width'], DEFAULT_TEXT_HALO_WIDTH)
    : undefined;

  const textHaloBlurEvaluator = paint['text-halo-blur'] !== undefined
    ? createNumberPropertyEvaluator(paint['text-halo-blur'], DEFAULT_TEXT_HALO_BLUR)
    : undefined;

  const textTranslateEvaluator = paint['text-translate'] !== undefined
    ? createNumberArrayPropertyEvaluator(paint['text-translate'], undefined, { allowNegative: true })
    : undefined;

  const textTranslateAnchorEvaluator = paint['text-translate-anchor'] !== undefined
    ? createStringPropertyEvaluator(paint['text-translate-anchor'], 'map')
    : undefined;

  const textOptionalEvaluator = layout['text-optional'] !== undefined
    ? createBooleanPropertyEvaluator(layout['text-optional'], false)
    : undefined;

  const textJustifyEvaluator = createStringPropertyEvaluator(
    layout['text-justify'] ?? DEFAULT_TEXT_JUSTIFY,
    DEFAULT_TEXT_JUSTIFY,
  );

  const textTransformEvaluator = createStringPropertyEvaluator(
    layout['text-transform'] ?? DEFAULT_TEXT_TRANSFORM,
    DEFAULT_TEXT_TRANSFORM,
  );

  const textLineHeightEvaluator = createNumberPropertyEvaluator(
    layout['text-line-height'] ?? DEFAULT_TEXT_LINE_HEIGHT,
    DEFAULT_TEXT_LINE_HEIGHT,
  );

  const textLetterSpacingEvaluator = createNumberPropertyEvaluator(
    layout['text-letter-spacing'] ?? DEFAULT_TEXT_LETTER_SPACING,
    DEFAULT_TEXT_LETTER_SPACING,
  );

  const textMaxWidthEvaluator = createNumberPropertyEvaluator(
    layout['text-max-width'] ?? DEFAULT_TEXT_MAX_WIDTH,
    DEFAULT_TEXT_MAX_WIDTH,
  );

  const textRadialOffsetEvaluator = createNumberPropertyEvaluator(
    layout['text-radial-offset'] ?? DEFAULT_TEXT_RADIAL_OFFSET,
    DEFAULT_TEXT_RADIAL_OFFSET,
  );

  const textMaxAngleEvaluator = createNumberPropertyEvaluator(
    layout['text-max-angle'] ?? DEFAULT_TEXT_MAX_ANGLE,
    DEFAULT_TEXT_MAX_ANGLE,
  );

  const textRotateEvaluator = createNumberPropertyEvaluator(
    layout['text-rotate'] ?? 0,
    0,
  );

  const textPaddingEvaluator = createNumberPropertyEvaluator(
    layout['text-padding'] ?? DEFAULT_TEXT_PADDING,
    DEFAULT_TEXT_PADDING,
  );

  const textAllowOverlapEvaluator = layout['text-allow-overlap'] !== undefined
    ? createBooleanPropertyEvaluator(layout['text-allow-overlap'], false)
    : undefined;

  const textOverlapEvaluator = layout['text-overlap'] !== undefined
    ? createStringPropertyEvaluator(layout['text-overlap'], 'never')
    : undefined;

  const textIgnorePlacementEvaluator = layout['text-ignore-placement'] !== undefined
    ? createBooleanPropertyEvaluator(layout['text-ignore-placement'], false)
    : undefined;

  const textRotationAlignmentEvaluator = layout['text-rotation-alignment'] !== undefined
    ? createStringPropertyEvaluator(layout['text-rotation-alignment'], 'auto')
    : undefined;

  const textPitchAlignmentEvaluator = layout['text-pitch-alignment'] !== undefined
    ? createStringPropertyEvaluator(layout['text-pitch-alignment'], 'auto')
    : undefined;

  const textKeepUprightEvaluator = layout['text-keep-upright'] !== undefined
    ? createBooleanPropertyEvaluator(layout['text-keep-upright'], true)
    : undefined;

  const iconImageEvaluator = layout['icon-image'] !== undefined
    ? createResolvedImagePropertyEvaluator(layout['icon-image'])
    : undefined;

  const iconOptionalEvaluator = layout['icon-optional'] !== undefined
    ? createBooleanPropertyEvaluator(layout['icon-optional'], false)
    : undefined;

  const iconTextFitEvaluator = createStringPropertyEvaluator(
    layout['icon-text-fit'] ?? DEFAULT_ICON_TEXT_FIT,
    DEFAULT_ICON_TEXT_FIT,
  );

  const iconTextFitPaddingEvaluator = layout['icon-text-fit-padding'] !== undefined
    ? createNumberArrayPropertyEvaluator(layout['icon-text-fit-padding'])
    : undefined;

  const iconRotateEvaluator = createNumberPropertyEvaluator(
    layout['icon-rotate'] ?? 0,
    0,
  );

  const iconPaddingEvaluator = createNumberPropertyEvaluator(
    layout['icon-padding'] ?? DEFAULT_ICON_PADDING,
    DEFAULT_ICON_PADDING,
  );

  const iconAllowOverlapEvaluator = layout['icon-allow-overlap'] !== undefined
    ? createBooleanPropertyEvaluator(layout['icon-allow-overlap'], false)
    : undefined;

  const iconOverlapEvaluator = layout['icon-overlap'] !== undefined
    ? createStringPropertyEvaluator(layout['icon-overlap'], 'never')
    : undefined;

  const iconIgnorePlacementEvaluator = layout['icon-ignore-placement'] !== undefined
    ? createBooleanPropertyEvaluator(layout['icon-ignore-placement'], false)
    : undefined;

  const iconRotationAlignmentEvaluator = layout['icon-rotation-alignment'] !== undefined
    ? createStringPropertyEvaluator(layout['icon-rotation-alignment'], 'auto')
    : undefined;

  const iconPitchAlignmentEvaluator = layout['icon-pitch-alignment'] !== undefined
    ? createStringPropertyEvaluator(layout['icon-pitch-alignment'], 'auto')
    : undefined;

  const iconKeepUprightEvaluator = layout['icon-keep-upright'] !== undefined
    ? createBooleanPropertyEvaluator(layout['icon-keep-upright'], false)
    : undefined;

  const iconTranslateEvaluator = paint['icon-translate'] !== undefined
    ? createNumberArrayPropertyEvaluator(paint['icon-translate'], undefined, { allowNegative: true })
    : undefined;

  const iconTranslateAnchorEvaluator = paint['icon-translate-anchor'] !== undefined
    ? createStringPropertyEvaluator(paint['icon-translate-anchor'], 'map')
    : undefined;

  const iconSizeEvaluator = createNumberPropertyEvaluator(
    layout['icon-size'] ?? DEFAULT_ICON_SIZE,
    DEFAULT_ICON_SIZE,
  );

  const iconColorEvaluator = paint['icon-color']
    ? createColorPropertyEvaluator(paint['icon-color'], '#ffffff')
    : undefined;

  const iconOpacityEvaluator = createNumberPropertyEvaluator(
    paint['icon-opacity'] ?? DEFAULT_ICON_OPACITY,
    DEFAULT_ICON_OPACITY,
  );

  return (context: LayerStyleContext): SymbolLayerStyle => {
    const style: SymbolLayerStyle = {
      zOrder: 'auto',
    };

    const sortKey = sortKeyEvaluator?.(context);
    if (sortKey !== undefined) {
      style.sortKey = sortKey;
    }
    style.sortKeyIsConstant = sortKeyEvaluator?.isConstant ?? true;

    style.zOrder = zOrderEvaluator(context) as SymbolLayerStyle['zOrder'];

    const symbolPlacement = symbolPlacementEvaluator?.(context);
    if (symbolPlacement) {
      style.symbolPlacement = symbolPlacement as SymbolLayerStyle['symbolPlacement'];
    }

    const symbolSpacing = symbolSpacingEvaluator?.(context);
    if (symbolSpacing !== undefined && symbolSpacing !== DEFAULT_SYMBOL_SPACING) {
      style.symbolSpacing = symbolSpacing;
    }

    const symbolAvoidEdges = symbolAvoidEdgesEvaluator?.(context);
    if (symbolAvoidEdges !== undefined) {
      style.symbolAvoidEdges = symbolAvoidEdges;
    }

    const textField = textFieldEvaluator?.(context);
    if (textField) {
      style.textField = textField;
    }

    const textFont = textFontEvaluator?.(context);
    if (Array.isArray(textFont) && textFont.length > 0) {
      style.textFont = textFont;
    }

    const textSize = textSizeEvaluator(context);
    if (textSize !== DEFAULT_TEXT_SIZE) {
      style.textSize = textSize;
    }

    const textColor = textColorEvaluator(context);
    if (textColor !== DEFAULT_TEXT_COLOR) {
      style.textColor = textColor;
    }

    const textOpacity = textOpacityEvaluator(context);
    if (textOpacity !== DEFAULT_TEXT_OPACITY) {
      style.textOpacity = textOpacity;
    }

    const textHaloColor = textHaloColorEvaluator?.(context);
    if (textHaloColor !== undefined && textHaloColor !== DEFAULT_TEXT_HALO_COLOR) {
      style.textHaloColor = textHaloColor;
    }

    const textHaloWidth = textHaloWidthEvaluator?.(context);
    if (textHaloWidth !== undefined && textHaloWidth !== DEFAULT_TEXT_HALO_WIDTH) {
      style.textHaloWidth = textHaloWidth;
    }

    const textHaloBlur = textHaloBlurEvaluator?.(context);
    if (textHaloBlur !== undefined && textHaloBlur !== DEFAULT_TEXT_HALO_BLUR) {
      style.textHaloBlur = textHaloBlur;
    }

    const textTranslate = textTranslateEvaluator?.(context);
    if (Array.isArray(textTranslate) && textTranslate.length === 2) {
      style.textTranslate = [textTranslate[0], textTranslate[1]];
    }

    const textTranslateAnchor = textTranslateAnchorEvaluator?.(context);
    if (textTranslateAnchor && textTranslateAnchor !== 'map') {
      style.textTranslateAnchor = textTranslateAnchor as SymbolLayerStyle['textTranslateAnchor'];
    }

    const textOptional = textOptionalEvaluator?.(context);
    if (textOptional !== undefined) {
      style.textOptional = textOptional;
    }

    const textJustify = textJustifyEvaluator(context);
    if (textJustify !== DEFAULT_TEXT_JUSTIFY) {
      style.textJustify = textJustify as SymbolLayerStyle['textJustify'];
    }

    const textTransform = textTransformEvaluator(context);
    if (textTransform !== DEFAULT_TEXT_TRANSFORM) {
      style.textTransform = textTransform as SymbolLayerStyle['textTransform'];
    }

    const textLineHeight = textLineHeightEvaluator(context);
    if (textLineHeight !== DEFAULT_TEXT_LINE_HEIGHT) {
      style.textLineHeight = textLineHeight;
    }

    const textLetterSpacing = textLetterSpacingEvaluator(context);
    if (textLetterSpacing !== DEFAULT_TEXT_LETTER_SPACING) {
      style.textLetterSpacing = textLetterSpacing;
    }

    const textMaxWidth = textMaxWidthEvaluator(context);
    if (textMaxWidth !== DEFAULT_TEXT_MAX_WIDTH) {
      style.textMaxWidth = textMaxWidth;
    }

    const textRadialOffset = textRadialOffsetEvaluator(context);
    if (textRadialOffset !== DEFAULT_TEXT_RADIAL_OFFSET) {
      style.textRadialOffset = textRadialOffset;
    }

    const textVariableAnchor = layout['text-variable-anchor'];
    if (Array.isArray(textVariableAnchor)) {
      style.textVariableAnchor = textVariableAnchor as NonNullable<SymbolLayerStyle['textVariableAnchor']>;
    }

    const textVariableAnchorOffset = layout['text-variable-anchor-offset'];
    if (Array.isArray(textVariableAnchorOffset)) {
      style.textVariableAnchorOffset = textVariableAnchorOffset as NonNullable<SymbolLayerStyle['textVariableAnchorOffset']>;
    }

    const textMaxAngle = textMaxAngleEvaluator(context);
    if (textMaxAngle !== DEFAULT_TEXT_MAX_ANGLE) {
      style.textMaxAngle = textMaxAngle;
    }

    const textWritingMode = layout['text-writing-mode'];
    if (Array.isArray(textWritingMode)) {
      style.textWritingMode = textWritingMode as NonNullable<SymbolLayerStyle['textWritingMode']>;
    }

    const textRotate = textRotateEvaluator(context);
    if (textRotate !== 0) {
      style.textRotate = textRotate;
    }

    const textPadding = textPaddingEvaluator(context);
    if (textPadding !== DEFAULT_TEXT_PADDING) {
      style.textPadding = textPadding;
    }

    const textAllowOverlap = textAllowOverlapEvaluator?.(context);
    if (textAllowOverlap !== undefined) {
      style.textAllowOverlap = textAllowOverlap;
    }

    const textOverlap = textOverlapEvaluator?.(context);
    if (textOverlap) {
      style.textOverlap = textOverlap as SymbolLayerStyle['textOverlap'];
    }

    const textIgnorePlacement = textIgnorePlacementEvaluator?.(context);
    if (textIgnorePlacement !== undefined) {
      style.textIgnorePlacement = textIgnorePlacement;
    }

    const textRotationAlignment = textRotationAlignmentEvaluator?.(context);
    if (textRotationAlignment) {
      style.textRotationAlignment = textRotationAlignment as SymbolLayerStyle['textRotationAlignment'];
    }

    const textPitchAlignment = textPitchAlignmentEvaluator?.(context);
    if (textPitchAlignment) {
      style.textPitchAlignment = textPitchAlignment as SymbolLayerStyle['textPitchAlignment'];
    }

    const textKeepUpright = textKeepUprightEvaluator?.(context);
    if (textKeepUpright !== undefined) {
      style.textKeepUpright = textKeepUpright;
    }

    const textOffset = layout['text-offset'];
    if (textOffset) {
      style.textOffset = textOffset as [number, number];
    }

    const textAnchor = layout['text-anchor'];
    if (textAnchor) {
      style.textAnchor = textAnchor as SymbolLayerStyle['textAnchor'];
    }

    const iconImage = iconImageEvaluator?.(context);
    if (iconImage) {
      style.iconImage = iconImage;
    }

    const iconOptional = iconOptionalEvaluator?.(context);
    if (iconOptional !== undefined) {
      style.iconOptional = iconOptional;
    }

    const iconTextFit = iconTextFitEvaluator(context);
    if (iconTextFit !== DEFAULT_ICON_TEXT_FIT) {
      style.iconTextFit = iconTextFit as SymbolLayerStyle['iconTextFit'];
    }

    const iconTextFitPadding = iconTextFitPaddingEvaluator?.(context);
    if (iconTextFitPadding?.length === 4
      && (iconTextFitPadding[0] !== 0
        || iconTextFitPadding[1] !== 0
        || iconTextFitPadding[2] !== 0
        || iconTextFitPadding[3] !== 0)) {
      style.iconTextFitPadding = [
        iconTextFitPadding[0],
        iconTextFitPadding[1],
        iconTextFitPadding[2],
        iconTextFitPadding[3],
      ];
    }

    const iconAllowOverlap = iconAllowOverlapEvaluator?.(context);
    if (iconAllowOverlap !== undefined) {
      style.iconAllowOverlap = iconAllowOverlap;
    }

    const iconOverlap = iconOverlapEvaluator?.(context);
    if (iconOverlap) {
      style.iconOverlap = iconOverlap as SymbolLayerStyle['iconOverlap'];
    }

    const iconIgnorePlacement = iconIgnorePlacementEvaluator?.(context);
    if (iconIgnorePlacement !== undefined) {
      style.iconIgnorePlacement = iconIgnorePlacement;
    }

    const iconRotationAlignment = iconRotationAlignmentEvaluator?.(context);
    if (iconRotationAlignment) {
      style.iconRotationAlignment = iconRotationAlignment as SymbolLayerStyle['iconRotationAlignment'];
    }

    const iconPitchAlignment = iconPitchAlignmentEvaluator?.(context);
    if (iconPitchAlignment) {
      style.iconPitchAlignment = iconPitchAlignment as SymbolLayerStyle['iconPitchAlignment'];
    }

    const iconKeepUpright = iconKeepUprightEvaluator?.(context);
    if (iconKeepUpright !== undefined) {
      style.iconKeepUpright = iconKeepUpright;
    }

    const iconTranslate = iconTranslateEvaluator?.(context);
    if (Array.isArray(iconTranslate) && iconTranslate.length === 2) {
      style.iconTranslate = [iconTranslate[0], iconTranslate[1]];
    }

    const iconTranslateAnchor = iconTranslateAnchorEvaluator?.(context);
    if (iconTranslateAnchor && iconTranslateAnchor !== 'map') {
      style.iconTranslateAnchor = iconTranslateAnchor as SymbolLayerStyle['iconTranslateAnchor'];
    }

    const iconRotate = iconRotateEvaluator(context);
    if (iconRotate !== 0) {
      style.iconRotate = iconRotate;
    }

    const iconPadding = iconPaddingEvaluator(context);
    if (iconPadding !== DEFAULT_ICON_PADDING) {
      style.iconPadding = iconPadding;
    }

    const iconSize = iconSizeEvaluator(context);
    if (iconSize !== DEFAULT_ICON_SIZE) {
      style.iconSize = iconSize;
    }

    const iconColor = iconColorEvaluator?.(context);
    if (iconColor) {
      style.iconColor = iconColor;
    }

    const iconOpacity = iconOpacityEvaluator(context);
    if (iconOpacity !== DEFAULT_ICON_OPACITY) {
      style.iconOpacity = iconOpacity;
    }

    const iconOffset = layout['icon-offset'];
    if (iconOffset) {
      style.iconOffset = iconOffset as [number, number];
    }

    const iconAnchor = layout['icon-anchor'];
    if (iconAnchor) {
      style.iconAnchor = iconAnchor as SymbolLayerStyle['iconAnchor'];
    }

    return style;
  };
}

export function createFillExtrusionLayerStyleResolver(
  layer: FillExtrusionLayerSpecification,
): (context: LayerStyleContext) => FillExtrusionLayerStyle {
  const paint = layer.paint ?? {};

  const colorEvaluator = createColorPropertyEvaluator(
    paint['fill-extrusion-color'] ?? DEFAULT_FILL_COLOR,
    DEFAULT_FILL_COLOR,
  );

  const opacityEvaluator = createNumberPropertyEvaluator(
    paint['fill-extrusion-opacity'] ?? DEFAULT_FILL_OPACITY,
    DEFAULT_FILL_OPACITY,
  );

  const baseEvaluator = createNumberPropertyEvaluator(
    paint['fill-extrusion-base'] ?? 0,
    0,
  );

  const heightEvaluator = createNumberPropertyEvaluator(
    paint['fill-extrusion-height'] ?? 0,
    0,
  );

  const patternEvaluator = paint['fill-extrusion-pattern'] !== undefined
    ? createStringPropertyEvaluator(paint['fill-extrusion-pattern'], '')
    : undefined;

  const verticalGradientEvaluator = createBooleanPropertyEvaluator(
    paint['fill-extrusion-vertical-gradient'] ?? true,
    true,
  );

  return (context: LayerStyleContext): FillExtrusionLayerStyle => ({
    base: baseEvaluator(context),
    color: colorEvaluator(context),
    height: heightEvaluator(context),
    opacity: opacityEvaluator(context),
    pattern: patternEvaluator?.(context) || undefined,
    verticalGradient: verticalGradientEvaluator(context),
  });
}
