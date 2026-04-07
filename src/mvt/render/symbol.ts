import type { Billboard, Label, Scene } from 'cesium';
import type { CompiledSymbolLayer } from '../style/renderer';
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
} from '../types';
import type { TileTransformContext } from './geometry';
import type { StyledSymbolPlacement } from './label';
import type { MapLibreSpriteAtlas } from './sprite';
import {

  BillboardCollection,
  Cartesian2,
  Color,

  LabelCollection,
  LabelStyle,

} from 'cesium';
import {

  resolveFormattedText,
} from '../style/renderer';
import { ScreenLabelCollisionIndex } from './collision';
import { ScreenSymbolDedupeIndex } from './dedupe';
import {
  addPrimitiveOrdered,
  applyOpacity,
  getFeatureAnchor,
  removeAndDestroyPrimitive,
  tilePointToCartesianWithContext,

} from './geometry';
import {
  applyTextTransform,
  buildSymbolDedupeKey,
  combinePixelOffsets,
  DEFAULT_TEXT_FONT_STACK,
  estimateScreenRect,
  fontStackToCss,
  normalizeSymbolKey,
  parseTextAnchor,
  resolveIconImageDimensions,
  resolveTextJustifyOrigin,
  resolveTextPixelOffset,

  textOffsetToPixelOffset,
  unionScreenRects,
  wrapSymbolText,
} from './label';
import { buildTextSpriteRequest, TextSpriteAtlas } from './text';

interface CreateStyledSymbolPlacementOptions {
  tile: DecodedTileRecord;
  layer: DecodedLayerRecord;
  feature: DecodedFeatureRecord;
  featureIndex: number;
  compiled: CompiledSymbolLayer;
  zoom: number;
  transformContext: TileTransformContext;
}

type PreparedStyledSymbolPlacement = StyledSymbolPlacement & {
  textAnchorCandidates: string[];
  screenY: number;
};

interface BillboardSpec {
  key: string;
  imageKey: string;
  image: HTMLCanvasElement | HTMLImageElement | string;
  position: StyledSymbolPlacement['candidate']['position'];
  color: Color;
  width: number;
  height: number;
  pixelOffset: Cartesian2;
  horizontalOrigin: ReturnType<typeof parseTextAnchor>['horizontalOrigin'];
  verticalOrigin: ReturnType<typeof parseTextAnchor>['verticalOrigin'];
  rotation: number;
  id: {
    tileId: string;
    layer: string;
    featureId: number | string | undefined;
    placementId: string;
  };
}

interface ManagedBillboard {
  billboard: Billboard;
  imageKey: string;
}

interface TextLabelSpec {
  key: string;
  text: string;
  font: string;
  position: StyledSymbolPlacement['candidate']['position'];
  fillColor: Color;
  outlineColor: Color;
  outlineWidth: number;
  style: LabelStyle;
  pixelOffset: Cartesian2;
  horizontalOrigin: ReturnType<typeof parseTextAnchor>['horizontalOrigin'];
  verticalOrigin: ReturnType<typeof parseTextAnchor>['verticalOrigin'];
  id: {
    tileId: string;
    layer: string;
    featureId: number | string | undefined;
    placementId: string;
  };
}

interface ManagedLabel {
  label: Label;
}

interface DesiredBucketState {
  placement: StyledSymbolPlacement;
  textSpecs: Map<string, TextLabelSpec>;
  iconSpecs: Map<string, BillboardSpec>;
}

interface SymbolBucketRuntime {
  tileId: string;
  bucketKey: string;
  order: number;
  textLabelCollection: LabelCollection;
  iconBillboardCollection: BillboardCollection;
  textLabels: Map<string, ManagedLabel>;
  iconBillboards: Map<string, ManagedBillboard>;
  setLabelsVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function createStyledSymbolPlacement(
  options: CreateStyledSymbolPlacementOptions,
): StyledSymbolPlacement | undefined {
  const {
    tile,
    layer,
    feature,
    featureIndex,
    compiled,
    zoom,
    transformContext,
  } = options;
  const style = compiled.symbol;
  const anchor = getFeatureAnchor(feature);
  if (!anchor) {
    return undefined;
  }

  const position = tilePointToCartesianWithContext(
    transformContext,
    anchor,
  );

  const textSize = Math.max(
    1,
    style.textSize?.evaluate(feature, zoom) ?? 16,
  );
  const textFieldValue = style.textField?.evaluate(feature, zoom);
  const textInfo = resolveFormattedText(textFieldValue);
  const rawText = textInfo.text.trim();
  const textTransform
    = style.textTransform?.evaluate(feature, zoom) ?? 'none';
  const textMaxWidth = style.textMaxWidth?.evaluate(feature, zoom) ?? 10;
  const textLineHeight = style.textLineHeight?.evaluate(feature, zoom) ?? 1.2;
  const textLetterSpacing
    = style.textLetterSpacing?.evaluate(feature, zoom) ?? 0;
  const transformedText = applyTextTransform(rawText, textTransform);
  const wrappedText = wrapSymbolText(
    transformedText,
    textMaxWidth,
    textSize,
    textLetterSpacing,
  );
  const text = wrappedText.trim();
  const textKey = normalizeSymbolKey(transformedText);

  const fontStack
    = style.textFont?.evaluate(feature, zoom)
      ?? textInfo.fontStack
      ?? DEFAULT_TEXT_FONT_STACK;
  const textOpacity = style.textOpacity?.evaluate(feature, zoom);
  const textColor = applyOpacity(
    style.textColor?.evaluate(feature, zoom)
    ?? textInfo.textColor
    ?? Color.WHITE,
    textOpacity,
  );
  const haloColor = applyOpacity(
    style.textHaloColor?.evaluate(feature, zoom)
    ?? Color.TRANSPARENT,
    textOpacity,
  );
  const haloWidth = Math.max(
    0,
    style.textHaloWidth?.evaluate(feature, zoom) ?? 0,
  );
  const textHaloBlur = style.textHaloBlur?.evaluate(feature, zoom) ?? 0;
  const textAnchorName = String(
    style.textAnchor?.evaluate(feature, zoom) ?? 'center',
  );
  const textVariableAnchors
    = style.textVariableAnchor?.evaluate(feature, zoom) ?? [];
  const textJustify = style.textJustify?.evaluate(feature, zoom) ?? 'auto';
  const textOffset = textOffsetToPixelOffset(
    style.textOffset?.evaluate(feature, zoom),
    textSize,
  );
  const textTranslateValue = style.textTranslate?.evaluate(feature, zoom);
  const textTranslate = textTranslateValue
    ? new Cartesian2(textTranslateValue[0], textTranslateValue[1])
    : new Cartesian2(0, 0);
  const textRadialOffset = style.textRadialOffset?.evaluate(feature, zoom) ?? 0;
  const textPadding = Math.max(
    0,
    style.textPadding?.evaluate(feature, zoom) ?? 2,
  );
  const textOverlap = style.textAllowOverlap?.evaluate(feature, zoom) ?? false;
  const overlapMode
    = style.textOverlap?.evaluate(feature, zoom)
      ?? (textOverlap ? 'always' : 'never');
  const ignorePlacement
    = style.textIgnorePlacement?.evaluate(feature, zoom) ?? false;
  const textOptional = style.textOptional?.evaluate(feature, zoom) ?? false;
  const sortKey = style.symbolSortKey?.evaluate(feature, zoom) ?? 0;
  const symbolZOrder = style.symbolZOrder?.evaluate(feature, zoom) ?? 'auto';
  const iconImageName = style.iconImage?.evaluate(feature, zoom) || undefined;
  const iconSize = Math.max(0.1, style.iconSize?.evaluate(feature, zoom) ?? 1);
  const iconOpacity = style.iconOpacity?.evaluate(feature, zoom) ?? 1;
  const iconColor = applyOpacity(
    style.iconColor?.evaluate(feature, zoom)
    ?? Color.BLACK,
    iconOpacity,
  );
  const iconAnchorName = String(
    style.iconAnchor?.evaluate(feature, zoom)
    ?? textAnchorName,
  );
  const iconOrigins = parseTextAnchor(iconAnchorName);
  const iconOffsetValue = style.iconOffset?.evaluate(feature, zoom);
  const iconOffset = iconOffsetValue
    ? new Cartesian2(
        iconOffsetValue[0] * iconSize,
        iconOffsetValue[1] * iconSize,
      )
    : new Cartesian2(0, 0);
  const iconTranslateValue = style.iconTranslate?.evaluate(feature, zoom);
  const iconTranslate = iconTranslateValue
    ? new Cartesian2(iconTranslateValue[0], iconTranslateValue[1])
    : new Cartesian2(0, 0);
  const iconAllowOverlap
    = style.iconAllowOverlap?.evaluate(feature, zoom) ?? false;
  const iconOverlapMode
    = style.iconOverlap?.evaluate(feature, zoom)
      ?? (iconAllowOverlap ? 'always' : 'never');
  const iconIgnorePlacement
    = style.iconIgnorePlacement?.evaluate(feature, zoom) ?? false;
  const iconOptional = style.iconOptional?.evaluate(feature, zoom) ?? false;
  const iconHaloColor = applyOpacity(
    style.iconHaloColor?.evaluate(feature, zoom)
    ?? Color.TRANSPARENT,
    iconOpacity,
  );
  const iconHaloWidth = Math.max(
    0,
    style.iconHaloWidth?.evaluate(feature, zoom) ?? 0,
  );
  const iconHaloBlur = Math.max(
    0,
    style.iconHaloBlur?.evaluate(feature, zoom) ?? 0,
  );
  const iconPadding = Math.max(
    0,
    style.iconPadding?.evaluate(feature, zoom) ?? 2,
  );
  const iconTextFit = style.iconTextFit?.evaluate(feature, zoom) ?? 'none';
  const iconTextFitPadding
    = style.iconTextFitPadding?.evaluate(feature, zoom)
      ?? [0, 0, 0, 0];
  const iconRotate
    = -((style.iconRotate?.evaluate(feature, zoom) ?? 0) * Math.PI)
      / 180;
  const featureKey = feature.id ?? `${layer.name}:${featureIndex}`;

  if (text.length === 0 && !iconImageName) {
    return undefined;
  }

  return {
    tileId: tile.id,
    tileLevel: tile.coord.level,
    bucketKey: `${tile.id}:${compiled.id}`,
    bucketOrder: compiled.order,
    compiledId: compiled.id,
    candidate: {
      labelId: `${tile.id}:${compiled.id}:${featureKey}`,
      featureId: feature.id,
      sourceIndex: featureIndex,
      position,
      text: text.length > 0 ? text : undefined,
      textKey: text.length > 0 ? textKey : undefined,
      textSize,
      fontStack,
      textColor,
      haloColor,
      haloWidth,
      haloBlur: textHaloBlur,
      pixelOffset: textOffset,
      textAnchor: textAnchorName,
      textVariableAnchors,
      textPadding,
      textLineHeight,
      textLetterSpacing,
      textJustify,
      textTranslate,
      textRadialOffset,
      ignorePlacement,
      overlapMode,
      optional: textOptional,
      symbolZOrder,
      sortKey,
      iconImageName,
      iconSize,
      iconColor,
      iconOpacity,
      iconHaloColor,
      iconHaloWidth,
      iconHaloBlur,
      iconAnchor: iconAnchorName,
      iconVerticalOrigin: iconOrigins.verticalOrigin,
      iconOffset,
      iconTranslate,
      iconPadding,
      iconTextFit,
      iconTextFitPadding,
      iconIgnorePlacement,
      iconOverlapMode,
      iconOptional,
      iconRotate,
    },
  };
}

export class SymbolRenderer {
  private readonly scene: Scene;
  private readonly primitiveOrderMap: WeakMap<object, number>;
  private readonly spriteAtlas?: MapLibreSpriteAtlas;
  private readonly textAtlas = new TextSpriteAtlas();
  private readonly symbolBucketRuntimes = new Map<string, SymbolBucketRuntime>();
  private readonly collisionIndex = new ScreenLabelCollisionIndex();
  private readonly dedupeIndex = new ScreenSymbolDedupeIndex();
  private lastPlacementSignature?: string;

  constructor(
    scene: Scene,
    primitiveOrderMap: WeakMap<object, number>,
    spriteAtlas?: MapLibreSpriteAtlas,
  ) {
    this.scene = scene;
    this.primitiveOrderMap = primitiveOrderMap;
    this.spriteAtlas = spriteAtlas;
  }

  get runtimeCount(): number {
    return this.symbolBucketRuntimes.size;
  }

  setVisible(visible: boolean): void {
    for (const runtime of this.symbolBucketRuntimes.values()) {
      runtime.setLabelsVisible(visible);
    }
  }

  clear(): void {
    for (const runtime of this.symbolBucketRuntimes.values()) {
      runtime.destroy();
    }
    this.symbolBucketRuntimes.clear();
  }

  destroy(): void {
    this.clear();
    this.textAtlas.destroy();
  }

  rebuild(
    placements: StyledSymbolPlacement[],
    labelsVisible: boolean,
  ): void {
    if (!labelsVisible || placements.length === 0) {
      this.clear();
      this.collisionIndex.clear();
      this.dedupeIndex.clear();
      this.lastPlacementSignature = undefined;
      this.scene.requestRender();
      return;
    }

    const signature = computePlacementSignature(placements);
    if (this.lastPlacementSignature === signature) {
      return;
    }

    this.lastPlacementSignature = signature;
    this.collisionIndex.clear();
    this.dedupeIndex.clear();
    const desiredBuckets = new Map<string, DesiredBucketState>();

    const orderedPlacements = placements
      .map(placement => ({
        ...placement,
        textAnchorCandidates: placement.candidate.text
          ? Array.from(
              new Set(
                placement.candidate.textVariableAnchors.length > 0
                  ? placement.candidate.textVariableAnchors
                  : [placement.candidate.textAnchor],
              ),
            )
          : [placement.candidate.textAnchor],
        screenY:
          this.scene.cartesianToCanvasCoordinates(
            placement.candidate.position,
            new Cartesian2(),
          )?.y ?? 0,
      }))
      .sort((left, right) =>
        compareStyledSymbolPlacements(left, right),
      );

    for (const placement of orderedPlacements) {
      this.placeSymbol(
        placement,
        desiredBuckets,
        this.collisionIndex,
        this.dedupeIndex,
      );
    }

    this.reconcileRuntimes(desiredBuckets, labelsVisible);
    this.scene.requestRender();
  }

  private placeSymbol(
    placement: PreparedStyledSymbolPlacement,
    desiredBuckets: Map<string, DesiredBucketState>,
    labelCollisionIndex: ScreenLabelCollisionIndex,
    symbolDedupeIndex: ScreenSymbolDedupeIndex,
  ): void {
    const candidate = placement.candidate;
    const textPlacementMode = candidate.ignorePlacement
      ? 'always'
      : candidate.overlapMode;
    const iconPlacementMode = candidate.iconIgnorePlacement
      ? 'always'
      : candidate.iconOverlapMode;
    const textAnchors
      = placement.textAnchorCandidates.length > 0
        ? placement.textAnchorCandidates
        : [candidate.textAnchor];

    for (const textAnchorName of textAnchors) {
      const textOrigins = {
        ...parseTextAnchor(textAnchorName),
        horizontalOrigin: resolveTextJustifyOrigin(
          textAnchorName,
          candidate.textJustify,
        ),
      };
      const textPixelOffset = resolveTextPixelOffset(
        candidate.pixelOffset,
        candidate.textTranslate,
        candidate.textRadialOffset,
        candidate.textSize,
        textOrigins,
      );
      const textLayout = candidate.text
        ? this.textAtlas.measure(
            buildTextSpriteRequest(candidate, candidate.text, textAnchorName),
          )
        : undefined;
      const textRect = textLayout
        ? estimateScreenRect(
            this.scene,
            candidate.position,
            textLayout.width,
            textLayout.height,
            textPixelOffset,
            textOrigins,
            0,
          )
        : undefined;

      const iconOrigins = parseTextAnchor(candidate.iconAnchor);
      const iconPixelOffset = combinePixelOffsets(
        candidate.iconOffset,
        candidate.iconTranslate,
      );
      const spriteEntry = candidate.iconImageName
        ? this.spriteAtlas?.resolve(candidate.iconImageName)
        : undefined;
      const spriteImage = candidate.iconImageName
        ? this.spriteAtlas?.getImage(candidate.iconImageName)
        : undefined;
      const resolvedIconRect
        = spriteEntry && spriteImage
          ? (() => {
              const iconDimensions = resolveIconImageDimensions(
                spriteEntry,
                candidate.iconSize,
                textRect,
                candidate.iconTextFit ?? 'none',
                candidate.iconTextFitPadding,
              );
              const iconRect = estimateScreenRect(
                this.scene,
                candidate.position,
                iconDimensions.width,
                iconDimensions.height,
                iconPixelOffset,
                {
                  horizontalOrigin: iconOrigins.horizontalOrigin,
                  verticalOrigin: candidate.iconVerticalOrigin,
                },
                candidate.iconPadding,
              );

              if (
                !iconRect
                || (candidate.iconHaloWidth <= 0 && candidate.iconHaloBlur <= 0)
              ) {
                return iconRect;
              }

              const haloSpread
                = candidate.iconHaloWidth + candidate.iconHaloBlur;
              const haloRect = estimateScreenRect(
                this.scene,
                candidate.position,
                iconDimensions.width + haloSpread * 2,
                iconDimensions.height + haloSpread * 2,
                iconPixelOffset,
                {
                  horizontalOrigin: iconOrigins.horizontalOrigin,
                  verticalOrigin: candidate.iconVerticalOrigin,
                },
                candidate.iconPadding,
              );
              return haloRect ? unionScreenRects(iconRect, haloRect) : iconRect;
            })()
          : undefined;

      if (!textRect && !resolvedIconRect) {
        continue;
      }

      const placementRect
        = textRect && resolvedIconRect
          ? unionScreenRects(textRect, resolvedIconRect)
          : textRect ?? resolvedIconRect;
      if (!placementRect) {
        continue;
      }

      const dedupeKey = buildSymbolDedupeKey(
        placement.compiledId,
        candidate,
        candidate.text,
      );
      if (!symbolDedupeIndex.canPlace(dedupeKey, placementRect)) {
        continue;
      }

      const textFits
        = textRect !== undefined
          && labelCollisionIndex.canPlace(textRect, textPlacementMode);
      const iconFits
        = resolvedIconRect !== undefined
          && labelCollisionIndex.canPlace(
            resolvedIconRect,
            iconPlacementMode,
          );

      const renderText
        = textRect !== undefined
          && (textFits
            || (iconFits && candidate.optional)
            || (resolvedIconRect !== undefined && candidate.iconOptional)
            || !resolvedIconRect);
      const renderIcon
        = resolvedIconRect !== undefined
          && (iconFits
            || (textFits && candidate.iconOptional)
            || (textRect !== undefined && candidate.optional)
            || !textRect);

      const acceptPlacement = candidate.text ? renderText : renderIcon;
      if (!acceptPlacement) {
        continue;
      }

      symbolDedupeIndex.add(candidate.labelId, dedupeKey, placementRect);
      const bucket = this.ensureDesiredBucket(placement, desiredBuckets);

      if (
        renderIcon
        && spriteEntry
        && spriteImage
        && resolvedIconRect
      ) {
        const baseColor = spriteEntry.sdf
          ? candidate.iconColor
          : new Color(1, 1, 1, candidate.iconOpacity);
        const iconDimensions = resolveIconImageDimensions(
          spriteEntry,
          candidate.iconSize,
          textRect,
          candidate.iconTextFit ?? 'none',
          candidate.iconTextFitPadding,
        );
        const haloSpread = candidate.iconHaloWidth + candidate.iconHaloBlur;
        const iconImageKey
          = candidate.iconImageName ?? `${candidate.labelId}:icon-image`;

        if (haloSpread > 0 && candidate.iconHaloColor.alpha > 0) {
          bucket.iconSpecs.set(`${candidate.labelId}:icon-halo`, {
            key: `${candidate.labelId}:icon-halo`,
            imageKey: iconImageKey,
            image: spriteImage,
            position: candidate.position,
            color: candidate.iconHaloColor,
            width: iconDimensions.width + haloSpread * 2,
            height: iconDimensions.height + haloSpread * 2,
            pixelOffset: iconPixelOffset,
            horizontalOrigin: iconOrigins.horizontalOrigin,
            verticalOrigin: candidate.iconVerticalOrigin,
            rotation: candidate.iconRotate,
            id: {
              tileId: placement.tileId,
              layer: placement.compiledId,
              featureId: candidate.featureId,
              placementId: `${candidate.labelId}:icon-halo`,
            },
          });
        }

        bucket.iconSpecs.set(`${candidate.labelId}:icon`, {
          key: `${candidate.labelId}:icon`,
          imageKey: iconImageKey,
          image: spriteImage,
          position: candidate.position,
          color: baseColor,
          width: iconDimensions.width,
          height: iconDimensions.height,
          pixelOffset: iconPixelOffset,
          horizontalOrigin: iconOrigins.horizontalOrigin,
          verticalOrigin: candidate.iconVerticalOrigin,
          rotation: candidate.iconRotate,
          id: {
            tileId: placement.tileId,
            layer: placement.compiledId,
            featureId: candidate.featureId,
            placementId: `${candidate.labelId}:icon`,
          },
        });
        labelCollisionIndex.add(
          `${candidate.labelId}:icon`,
          resolvedIconRect,
          iconPlacementMode,
          !candidate.iconIgnorePlacement,
        );
      }

      if (renderText && textRect && candidate.text && textLayout) {
        const outlineWidth = Math.max(
          0,
          candidate.haloWidth + candidate.haloBlur * 0.5,
        );
        bucket.textSpecs.set(`${candidate.labelId}:text`, {
          key: `${candidate.labelId}:text`,
          text: candidate.text,
          font: `${candidate.textSize}px ${fontStackToCss(candidate.fontStack)}`,
          position: candidate.position,
          fillColor: candidate.textColor,
          outlineColor: candidate.haloColor,
          outlineWidth,
          style:
            outlineWidth > 0 && candidate.haloColor.alpha > 0
              ? LabelStyle.FILL_AND_OUTLINE
              : LabelStyle.FILL,
          pixelOffset: textPixelOffset,
          horizontalOrigin: textOrigins.horizontalOrigin,
          verticalOrigin: textOrigins.verticalOrigin,
          id: {
            tileId: placement.tileId,
            layer: placement.compiledId,
            featureId: candidate.featureId,
            placementId: `${candidate.labelId}:text`,
          },
        });
        labelCollisionIndex.add(
          `${candidate.labelId}:text`,
          textRect,
          textPlacementMode,
          !candidate.ignorePlacement,
        );
      }

      break;
    }
  }

  private ensureDesiredBucket(
    placement: StyledSymbolPlacement,
    desiredBuckets: Map<string, DesiredBucketState>,
  ): DesiredBucketState {
    const existing = desiredBuckets.get(placement.bucketKey);
    if (existing) {
      return existing;
    }

    const created: DesiredBucketState = {
      placement,
      textSpecs: new Map<string, TextLabelSpec>(),
      iconSpecs: new Map<string, BillboardSpec>(),
    };
    desiredBuckets.set(placement.bucketKey, created);
    return created;
  }

  private reconcileRuntimes(
    desiredBuckets: Map<string, DesiredBucketState>,
    labelsVisible: boolean,
  ): void {
    for (const [bucketKey, runtime] of Array.from(this.symbolBucketRuntimes.entries())) {
      if (desiredBuckets.has(bucketKey)) {
        continue;
      }

      runtime.destroy();
      this.symbolBucketRuntimes.delete(bucketKey);
    }

    for (const desired of desiredBuckets.values()) {
      const runtime = this.ensureRuntime(desired.placement, labelsVisible);
      runtime.setLabelsVisible(labelsVisible);
      this.reconcileLabels(
        runtime.textLabelCollection,
        runtime.textLabels,
        desired.textSpecs,
      );
      this.reconcileBillboards(
        runtime.iconBillboardCollection,
        runtime.iconBillboards,
        desired.iconSpecs,
      );

      if (runtime.textLabels.size === 0 && runtime.iconBillboards.size === 0) {
        runtime.destroy();
        this.symbolBucketRuntimes.delete(runtime.bucketKey);
      }
    }
  }

  private reconcileLabels(
    collection: LabelCollection,
    managedEntries: Map<string, ManagedLabel>,
    desiredSpecs: Map<string, TextLabelSpec>,
  ): void {
    for (const [key, managed] of Array.from(managedEntries.entries())) {
      if (desiredSpecs.has(key)) {
        continue;
      }

      collection.remove(managed.label);
      managedEntries.delete(key);
    }

    for (const [key, spec] of desiredSpecs) {
      const existing = managedEntries.get(key);
      if (existing) {
        this.applyLabelSpec(existing, spec);
        continue;
      }

      const created = collection.add({
        show: true,
        position: spec.position,
        text: spec.text,
        font: spec.font,
        fillColor: spec.fillColor,
        outlineColor: spec.outlineColor,
        outlineWidth: spec.outlineWidth,
        style: spec.style,
        pixelOffset: spec.pixelOffset,
        horizontalOrigin: spec.horizontalOrigin,
        verticalOrigin: spec.verticalOrigin,
        id: spec.id,
      });
      managedEntries.set(key, {
        label: created,
      });
    }
  }

  private reconcileBillboards(
    collection: BillboardCollection,
    managedEntries: Map<string, ManagedBillboard>,
    desiredSpecs: Map<string, BillboardSpec>,
  ): void {
    for (const [key, managed] of Array.from(managedEntries.entries())) {
      if (desiredSpecs.has(key)) {
        continue;
      }

      collection.remove(managed.billboard);
      managedEntries.delete(key);
    }

    for (const [key, spec] of desiredSpecs) {
      const existing = managedEntries.get(key);
      if (existing) {
        this.applyBillboardSpec(existing, spec);
        continue;
      }

      const created = collection.add({
        show: true,
        position: spec.position,
        image: spec.image,
        color: spec.color,
        width: spec.width,
        height: spec.height,
        pixelOffset: spec.pixelOffset,
        horizontalOrigin: spec.horizontalOrigin,
        verticalOrigin: spec.verticalOrigin,
        rotation: spec.rotation,
        id: spec.id,
      });
      managedEntries.set(key, {
        billboard: created,
        imageKey: spec.imageKey,
      });
    }
  }

  private applyBillboardSpec(
    managed: ManagedBillboard,
    spec: BillboardSpec,
  ): void {
    if (managed.imageKey !== spec.imageKey) {
      managed.billboard.setImage(spec.imageKey, spec.image);
      managed.imageKey = spec.imageKey;
    }

    managed.billboard.show = true;
    managed.billboard.position = spec.position;
    managed.billboard.color = spec.color;
    managed.billboard.width = spec.width;
    managed.billboard.height = spec.height;
    managed.billboard.pixelOffset = spec.pixelOffset;
    managed.billboard.horizontalOrigin = spec.horizontalOrigin;
    managed.billboard.verticalOrigin = spec.verticalOrigin;
    managed.billboard.rotation = spec.rotation;
    managed.billboard.id = spec.id;
  }

  private applyLabelSpec(
    managed: ManagedLabel,
    spec: TextLabelSpec,
  ): void {
    managed.label.show = true;
    managed.label.position = spec.position;
    managed.label.text = spec.text;
    managed.label.font = spec.font;
    managed.label.fillColor = spec.fillColor;
    managed.label.outlineColor = spec.outlineColor;
    managed.label.outlineWidth = spec.outlineWidth;
    managed.label.style = spec.style;
    managed.label.pixelOffset = spec.pixelOffset;
    managed.label.horizontalOrigin = spec.horizontalOrigin;
    managed.label.verticalOrigin = spec.verticalOrigin;
    managed.label.id = spec.id;
  }

  private ensureRuntime(
    placement: StyledSymbolPlacement,
    labelsVisible: boolean,
  ): SymbolBucketRuntime {
    const existing = this.symbolBucketRuntimes.get(placement.bucketKey);
    if (existing) {
      return existing;
    }

    const layerOrderBase
      = placement.tileLevel * 100_000 + placement.bucketOrder * 100;
    const textLabelCollection = new LabelCollection({
      scene: this.scene,
      show: labelsVisible,
    });
    addPrimitiveOrdered(
      this.scene,
      this.primitiveOrderMap,
      textLabelCollection,
      layerOrderBase + 90,
    );

    const iconBillboardCollection = new BillboardCollection({
      show: labelsVisible,
    });
    addPrimitiveOrdered(
      this.scene,
      this.primitiveOrderMap,
      iconBillboardCollection,
      layerOrderBase + 80,
    );

    const runtime: SymbolBucketRuntime = {
      tileId: placement.tileId,
      bucketKey: placement.bucketKey,
      order: placement.bucketOrder,
      textLabelCollection,
      iconBillboardCollection,
      textLabels: new Map<string, ManagedLabel>(),
      iconBillboards: new Map<string, ManagedBillboard>(),
      setLabelsVisible: (visible: boolean) => {
        textLabelCollection.show = visible;
        iconBillboardCollection.show = visible;
      },
      destroy: () => {
        removeAndDestroyPrimitive(this.scene, textLabelCollection);
        removeAndDestroyPrimitive(this.scene, iconBillboardCollection);
      },
    };

    this.symbolBucketRuntimes.set(placement.bucketKey, runtime);
    return runtime;
  }
}

function compareStyledSymbolPlacements(
  left: PreparedStyledSymbolPlacement,
  right: PreparedStyledSymbolPlacement,
): number {
  const tileDelta = right.tileLevel - left.tileLevel;
  if (tileDelta !== 0) {
    return tileDelta;
  }

  const layerDelta = right.bucketOrder - left.bucketOrder;
  if (layerDelta !== 0) {
    return layerDelta;
  }

  const sortDelta = left.candidate.sortKey - right.candidate.sortKey;
  if (sortDelta !== 0) {
    return sortDelta;
  }

  const leftZOrder = left.candidate.symbolZOrder;
  const rightZOrder = right.candidate.symbolZOrder;

  if (leftZOrder === 'source' || rightZOrder === 'source') {
    return left.candidate.sourceIndex - right.candidate.sourceIndex;
  }

  if (leftZOrder === 'viewport-y' || rightZOrder === 'viewport-y') {
    const yDelta = left.screenY - right.screenY;
    if (yDelta !== 0) {
      return yDelta;
    }
  }

  if (leftZOrder === 'auto' || rightZOrder === 'auto') {
    const yDelta = left.screenY - right.screenY;
    if (yDelta !== 0) {
      return yDelta;
    }
  }

  return left.candidate.sourceIndex - right.candidate.sourceIndex;
}

function computePlacementSignature(placements: StyledSymbolPlacement[]): string {
  return placements.map(p => p.bucketKey).join(',');
}
