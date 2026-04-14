import type { SymbolLayerStyle } from '../../style/layer-style-resolver';
import type { resolveStyleImage } from '../../style/sprite-atlas';
import type { SymbolPlacementGrid, SymbolPlacementGridPlacement } from './symbol-placement-grid';
import type { ResolvedSymbolTextContent, SymbolCollision, SymbolTextLayout } from './symbol-render-utils';
import { Cartesian3, Cartographic, Ellipsoid, WebMercatorProjection } from 'cesium';
import { measureSymbolContentBox } from './symbol-render-utils';

const DEFAULT_TEXT_MAX_ANGLE = 45;
const WEB_MERCATOR_PROJECTION = new WebMercatorProjection();
const SCRATCH_CARTOGRAPHIC = new Cartographic();
const SCRATCH_WEB_MERCATOR_POSITION = new Cartesian3();
const SCRATCH_TRANSLATED_CARTOGRAPHIC = new Cartographic();

export interface TileNativeRectangle {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface TileCoordinate {
  level: number;
  x: number;
  y: number;
}

export function resolveTextAnchorCandidates(
  symbolStyle: SymbolLayerStyle,
): NonNullable<SymbolLayerStyle['textAnchor']>[] {
  if (symbolStyle.textVariableAnchor?.length) {
    return symbolStyle.textVariableAnchor as NonNullable<SymbolLayerStyle['textAnchor']>[];
  }

  return [symbolStyle.textAnchor ?? 'center'];
}

export function resolveTextAnchorOffset(
  symbolStyle: SymbolLayerStyle,
  anchor: NonNullable<SymbolLayerStyle['textAnchor']>,
): [number, number] | undefined {
  if (symbolStyle.textVariableAnchorOffset?.length) {
    for (let index = 0; index < symbolStyle.textVariableAnchorOffset.length - 1; index += 2) {
      const entryAnchor = symbolStyle.textVariableAnchorOffset[index];
      const entryOffset = symbolStyle.textVariableAnchorOffset[index + 1];
      if (entryAnchor === anchor && Array.isArray(entryOffset) && entryOffset.length === 2) {
        return [entryOffset[0], entryOffset[1]];
      }
    }
  }

  return symbolStyle.textOffset;
}

export function resolveTranslatedSymbolPosition(
  basePosition: Cartesian3,
  translateOffset: [number, number] | undefined,
  translateAnchor: SymbolLayerStyle['textTranslateAnchor'] | SymbolLayerStyle['iconTranslateAnchor'] | undefined,
  tileRectangle: TileNativeRectangle,
  tileWidth: number,
): {
  position: Cartesian3;
  viewportOffset?: [number, number];
} {
  if (!translateOffset) {
    return {
      position: basePosition,
    };
  }

  if (translateAnchor === 'viewport') {
    return {
      position: basePosition,
      viewportOffset: translateOffset,
    };
  }

  // Map anchor 需要先在瓦片对应的 Mercator 平面里做平移，再回投到世界坐标。
  // 这样 symbol 的实际位置和跨瓦片匹配锚点会一起移动，而不会只表现成屏幕偏移。
  const cartographic = Cartographic.fromCartesian(
    basePosition,
    Ellipsoid.WGS84,
    SCRATCH_CARTOGRAPHIC,
  );
  const mercatorPosition = WEB_MERCATOR_PROJECTION.project(
    cartographic,
    SCRATCH_WEB_MERCATOR_POSITION,
  );
  const nativeWidth = tileRectangle.east - tileRectangle.west;
  const nativeHeight = tileRectangle.north - tileRectangle.south;
  mercatorPosition.x += (translateOffset[0] / tileWidth) * nativeWidth;
  mercatorPosition.y -= (translateOffset[1] / tileWidth) * nativeHeight;
  const translatedCartographic = WEB_MERCATOR_PROJECTION.unproject(
    mercatorPosition,
    SCRATCH_TRANSLATED_CARTOGRAPHIC,
  );

  return {
    position: Cartesian3.fromRadians(
      translatedCartographic.longitude,
      translatedCartographic.latitude,
      translatedCartographic.height,
    ),
  };
}

export function createSymbolPlacementCollision(
  symbolStyle: SymbolLayerStyle,
  symbolText: ResolvedSymbolTextContent | string,
  iconImage: ReturnType<typeof resolveStyleImage>,
  tileWidth: number,
  zoom: number,
  anchor: SymbolLayerStyle['textAnchor'],
  offset?: [number, number],
  formattedLayout?: SymbolTextLayout,
): SymbolCollision | undefined {
  // Cesium 没有 MapLibre 那套完整的 symbol placement/collision 引擎，
  // 这里先用文本和图标的近似包围盒压住同名近邻重复，避免同一标签在相邻锚点上反复冒出来。
  const content = typeof symbolText === 'string'
    ? {
        key: symbolText,
        text: symbolText,
      }
    : symbolText;
  const overlapMode = content.text
    ? (symbolStyle.textOverlap
      ?? (symbolStyle.textAllowOverlap ? 'always' : 'never'))
    : (symbolStyle.iconOverlap
      ?? (symbolStyle.iconAllowOverlap ? 'always' : 'never'));

  const blocksOtherSymbols = content.text
    ? !(symbolStyle.textIgnorePlacement || overlapMode === 'always')
    : !(symbolStyle.iconIgnorePlacement || overlapMode === 'always');

  const measured = measureSymbolContentBox(symbolStyle, content, iconImage, formattedLayout);
  const width = measured.width;
  const height = measured.height;
  if (width === 0 && height === 0) {
    return undefined;
  }

  const worldScale = tileWidth * (2 ** zoom);
  const anchorOffset = resolveAnchorOffset(anchor, width, height);
  return {
    centerOffsetX: (anchorOffset.x / worldScale) + ((offset?.[0] ?? 0) / worldScale),
    centerOffsetY: (anchorOffset.y / worldScale) + ((offset?.[1] ?? 0) / worldScale),
    blocksOtherSymbols,
    halfHeight: height / worldScale / 2,
    halfWidth: width / worldScale / 2,
    overlapMode,
  };
}

export function shouldSkipSymbolPlacement(
  placement: SymbolPlacementGridPlacement,
  placementGrid: SymbolPlacementGrid,
): boolean {
  const collision = placement.collision;
  if (!collision || collision.overlapMode === 'always') {
    return false;
  }

  const candidates = placementGrid.query(placement);
  for (const accepted of candidates) {
    const acceptedCollision = accepted.collision;
    if (!acceptedCollision?.blocksOtherSymbols) {
      continue;
    }

    if (hasCollisionOverlap(accepted, placement)) {
      return true;
    }
  }

  return false;
}

export function shouldSkipTextAngle(
  symbolStyle: SymbolLayerStyle,
  lineAngle: number | undefined,
): boolean {
  if (lineAngle === undefined) {
    return false;
  }

  // 当前符号路径没有 MapLibre 那种逐 glyph 的沿线 shaping，
  // 这里用 line anchor 的局部折角近似 `text-max-angle` 的约束。
  const maxAngle = symbolStyle.textMaxAngle ?? DEFAULT_TEXT_MAX_ANGLE;
  return Math.abs(lineAngle) > maxAngle;
}

export function isPlacementNearTileEdge(
  placement: SymbolPlacementGridPlacement,
  tileCoordinate: TileCoordinate,
): boolean {
  const collision = placement.collision;
  if (!collision) {
    return false;
  }

  const tileScale = 2 ** tileCoordinate.level;
  const tileMinX = tileCoordinate.x / tileScale;
  const tileMaxX = (tileCoordinate.x + 1) / tileScale;
  const tileMinY = tileCoordinate.y / tileScale;
  const tileMaxY = (tileCoordinate.y + 1) / tileScale;
  const centerX = placement.anchorX + collision.centerOffsetX;
  const centerY = placement.anchorY + collision.centerOffsetY;
  const boxMinX = centerX - collision.halfWidth;
  const boxMaxX = centerX + collision.halfWidth;
  const boxMinY = centerY - collision.halfHeight;
  const boxMaxY = centerY + collision.halfHeight;

  return boxMinX <= tileMinX
    || boxMaxX >= tileMaxX
    || boxMinY <= tileMinY
    || boxMaxY >= tileMaxY;
}

export function getViewportLatitude(position: Cartesian3): number {
  const cartographic = Cartographic.fromCartesian(
    position,
    Ellipsoid.WGS84,
  );
  return cartographic.latitude;
}

export function getSymbolMatchAnchor(position: Cartesian3): {
  anchorX: number;
  anchorY: number;
} {
  // MapLibre 在 WebMercator 的锚点空间里做跨瓦片匹配，这里把 Cesium 世界坐标折回同一坐标系，
  // 让同一地理位置在不同 zoom 下仍然能按相同锚点聚合。
  const cartographic = Cartographic.fromCartesian(
    position,
    Ellipsoid.WGS84,
  );

  const anchorX = normalizeMercatorX(
    (cartographic.longitude + Math.PI) / (2 * Math.PI),
  );
  const sinLatitude = clamp(
    Math.sin(cartographic.latitude),
    -0.999999999999,
    0.999999999999,
  );
  const anchorY = clamp(
    0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI),
    0,
    1,
  );

  return {
    anchorX,
    anchorY,
  };
}

function hasCollisionOverlap(
  left: SymbolPlacementGridPlacement,
  right: SymbolPlacementGridPlacement,
): boolean {
  const leftCollision = left.collision;
  const rightCollision = right.collision;
  if (!leftCollision || !rightCollision) {
    return false;
  }

  const leftCenterX = left.anchorX + leftCollision.centerOffsetX;
  const leftCenterY = left.anchorY + leftCollision.centerOffsetY;
  const rightCenterX = right.anchorX + rightCollision.centerOffsetX;
  const rightCenterY = right.anchorY + rightCollision.centerOffsetY;

  const deltaX = Math.abs(leftCenterX - rightCenterX);
  const deltaY = Math.abs(leftCenterY - rightCenterY);
  return deltaX <= leftCollision.halfWidth + rightCollision.halfWidth
    && deltaY <= leftCollision.halfHeight + rightCollision.halfHeight;
}

function resolveAnchorOffset(
  anchor: SymbolLayerStyle['textAnchor'],
  width: number,
  height: number,
): {
  x: number;
  y: number;
} {
  let offsetX = 0;
  let offsetY = 0;

  if (anchor?.includes('left')) {
    offsetX = width / 2;
  }
  else if (anchor?.includes('right')) {
    offsetX = -width / 2;
  }

  if (anchor?.includes('top')) {
    offsetY = height / 2;
  }
  else if (anchor?.includes('bottom')) {
    offsetY = -height / 2;
  }

  return {
    x: offsetX,
    y: offsetY,
  };
}

function normalizeMercatorX(value: number): number {
  return ((value % 1) + 1) % 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
