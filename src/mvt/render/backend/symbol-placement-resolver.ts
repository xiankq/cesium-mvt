import type { SymbolLayerStyle } from '../../style/layer-style-resolver';
import type { resolveStyleImage } from '../../style/sprite-atlas';
import type { SymbolPlacementGrid, SymbolPlacementGridPlacement } from './symbol-placement-grid';
import type { TileCoordinate } from './symbol-placement-utils';
import type { ResolvedSymbolTextContent, SymbolCollision, SymbolTextLayout } from './symbol-render-utils';
import { resolveStyleImageName } from '../../style/sprite-atlas';
import {
  createSymbolPlacementCollision,
  isPlacementNearTileEdge,
  resolveTextAnchorCandidates,
  resolveTextAnchorOffset,
  shouldSkipSymbolPlacement,
  shouldSkipTextAngle,
} from './symbol-placement-utils';
import { combinePixelOffsets } from './symbol-render-utils';

export interface SymbolPlacementBase {
  anchorX: number;
  anchorY: number;
  key: string;
  layerId: string;
}

export interface SymbolPlacementResolution {
  collision?: SymbolCollision;
  textAnchor?: SymbolLayerStyle['textAnchor'];
  textOffset?: [number, number];
}

export interface IconPlacementResolution {
  collision?: SymbolCollision;
  iconAnchor?: SymbolLayerStyle['iconAnchor'];
  iconOffset?: [number, number];
}

export function createSymbolPlacementKey(
  sourceId: string,
  layerId: string,
  symbolStyle: SymbolLayerStyle,
  symbolText: ResolvedSymbolTextContent | string,
): string {
  const symbolIdentity = typeof symbolText === 'string'
    ? symbolText
    : symbolText.key;
  const identity = symbolIdentity || resolveStyleImageName(symbolStyle.iconImage) || '';

  // MapLibre 的 cross-tile 去重核心是“文本 + 锚点”，图标只在没有文本时作为兜底身份。
  // 这样同名 label 不会因为 icon 差异被拆成两个独立符号。
  return `${sourceId}|${layerId}|${identity}`;
}

export function resolveSymbolPlacement(
  symbolStyle: SymbolLayerStyle,
  symbolText: ResolvedSymbolTextContent | string,
  iconImage: ReturnType<typeof resolveStyleImage>,
  tileWidth: number,
  zoom: number,
  tileCoordinate: TileCoordinate,
  placementGrid: SymbolPlacementGrid,
  lineAngle: number | undefined,
  basePlacement: SymbolPlacementBase,
  viewportTranslateOffset?: [number, number],
  formattedLayout?: SymbolTextLayout,
): SymbolPlacementResolution | undefined {
  const content = typeof symbolText === 'string'
    ? {
        key: symbolText,
        text: symbolText,
      }
    : symbolText;

  if (!symbolStyle.textField) {
    const iconAnchor = symbolStyle.iconAnchor ?? symbolStyle.textAnchor ?? 'center';
    const iconOffset = combinePixelOffsets(symbolStyle.iconOffset, viewportTranslateOffset);
    const collision = createSymbolPlacementCollision(
      symbolStyle,
      content,
      iconImage,
      tileWidth,
      zoom,
      iconAnchor,
      iconOffset,
      formattedLayout,
    );

    if (symbolStyle.symbolAvoidEdges && isPlacementNearTileEdge({
      anchorX: basePlacement.anchorX,
      anchorY: basePlacement.anchorY,
      collision,
      key: basePlacement.key,
      layerId: basePlacement.layerId,
      textAnchor: iconAnchor,
      textOffset: iconOffset,
    }, tileCoordinate)) {
      return undefined;
    }

    if (shouldSkipSymbolPlacement({
      anchorX: basePlacement.anchorX,
      anchorY: basePlacement.anchorY,
      collision,
      key: basePlacement.key,
      layerId: basePlacement.layerId,
      textAnchor: iconAnchor,
      textOffset: iconOffset,
    }, placementGrid)) {
      return undefined;
    }

    return {
      collision,
      textAnchor: iconAnchor,
      textOffset: iconOffset,
    };
  }

  // MapLibre 会按 variable anchor 的顺序尝试候选位置，这里沿用同样的优先级，
  // 只在找不到可用位置时才回退到默认锚点。
  const anchorCandidates = resolveTextAnchorCandidates(symbolStyle);
  for (const anchor of anchorCandidates) {
    const textOffset = combinePixelOffsets(
      resolveTextAnchorOffset(symbolStyle, anchor),
      viewportTranslateOffset,
    );
    const collision = createSymbolPlacementCollision(
      symbolStyle,
      content,
      iconImage,
      tileWidth,
      zoom,
      anchor,
      textOffset,
      formattedLayout,
    );
    const candidatePlacement: SymbolPlacementGridPlacement = {
      anchorX: basePlacement.anchorX,
      anchorY: basePlacement.anchorY,
      collision,
      key: basePlacement.key,
      layerId: basePlacement.layerId,
      lineAngle,
      textAnchor: anchor,
      textOffset,
    };

    if (shouldSkipTextAngle(symbolStyle, lineAngle)) {
      continue;
    }

    if (symbolStyle.symbolAvoidEdges && isPlacementNearTileEdge(candidatePlacement, tileCoordinate)) {
      continue;
    }

    if (!shouldSkipSymbolPlacement(candidatePlacement, placementGrid)) {
      return {
        collision,
        textAnchor: anchor,
        textOffset,
      };
    }
  }

  const fallbackAnchor = anchorCandidates[0];
  if (!fallbackAnchor) {
    return undefined;
  }

  const textOffset = combinePixelOffsets(
    resolveTextAnchorOffset(symbolStyle, fallbackAnchor),
    viewportTranslateOffset,
  );
  const collision = createSymbolPlacementCollision(
    symbolStyle,
    content,
    iconImage,
    tileWidth,
    zoom,
    fallbackAnchor,
    textOffset,
    formattedLayout,
  );

  if (shouldSkipTextAngle(symbolStyle, lineAngle)) {
    return undefined;
  }

  if (symbolStyle.symbolAvoidEdges && isPlacementNearTileEdge({
    anchorX: basePlacement.anchorX,
    anchorY: basePlacement.anchorY,
    collision,
    key: basePlacement.key,
    layerId: basePlacement.layerId,
    lineAngle,
    textAnchor: fallbackAnchor,
    textOffset,
  }, tileCoordinate)) {
    return undefined;
  }

  if (
    collision
    && (
      collision.overlapMode === 'always'
      || symbolStyle.textAllowOverlap
      || symbolStyle.textIgnorePlacement
      || symbolStyle.textOverlap === 'always'
    )
  ) {
    return {
      collision,
      textAnchor: fallbackAnchor,
      textOffset,
    };
  }

  return undefined;
}

export function resolveIconPlacement(
  symbolStyle: SymbolLayerStyle,
  iconImage: ReturnType<typeof resolveStyleImage>,
  tileWidth: number,
  zoom: number,
  tileCoordinate: TileCoordinate,
  placementGrid: SymbolPlacementGrid,
  basePlacement: SymbolPlacementBase,
  viewportTranslateOffset?: [number, number],
): IconPlacementResolution | undefined {
  const iconAnchor = symbolStyle.iconAnchor ?? symbolStyle.textAnchor ?? 'center';
  const iconOffset = combinePixelOffsets(symbolStyle.iconOffset, viewportTranslateOffset);
  const collision = createSymbolPlacementCollision(
    symbolStyle,
    '',
    iconImage,
    tileWidth,
    zoom,
    iconAnchor,
    iconOffset,
  );

  if (symbolStyle.symbolAvoidEdges && isPlacementNearTileEdge({
    anchorX: basePlacement.anchorX,
    anchorY: basePlacement.anchorY,
    collision,
    key: basePlacement.key,
    layerId: basePlacement.layerId,
    textAnchor: iconAnchor,
    textOffset: iconOffset,
  }, tileCoordinate)) {
    return undefined;
  }

  if (shouldSkipSymbolPlacement({
    anchorX: basePlacement.anchorX,
    anchorY: basePlacement.anchorY,
    collision,
    key: basePlacement.key,
    layerId: basePlacement.layerId,
    textAnchor: iconAnchor,
    textOffset: iconOffset,
  }, placementGrid)) {
    return undefined;
  }

  return {
    collision,
    iconAnchor,
    iconOffset,
  };
}
