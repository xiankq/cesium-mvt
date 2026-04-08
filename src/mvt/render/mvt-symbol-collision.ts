import type { Scene } from '@cesium/engine';
import type { MvtSymbolCollisionBox } from './mvt-symbol-types';
import { Cartesian2, Cartesian3, Ellipsoid, HorizontalOrigin, SceneTransforms, VerticalOrigin } from '@cesium/engine';
import { MvtGridIndex } from './mvt-grid-index';

type OverlapMode = 'always' | 'never';
type ZOrderMode = 'auto' | 'viewport-y' | 'source';

interface CollisionKey {
  crossTileID?: string;
  layerId?: string;
  overlapMode: OverlapMode;
}

interface ScreenBox {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface TileBox {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface SortablePlacement {
  box: MvtSymbolCollisionBox;
  sortKey: number;
  screenY: number;
}

const VIEWPORT_PADDING = 100;
const CELL_SIZE = 25;
const PERSPECTIVE_RATIO_CUTOFF = 0.6;
const COORDINATE_PRECISION = 1000000;

function boxesIntersect(a: TileBox, b: TileBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function generateCrossTileID(
  longitude: number,
  latitude: number,
  layerId: string,
  text?: string,
  image?: string,
): string {
  const lon = Math.round(longitude * COORDINATE_PRECISION);
  const lat = Math.round(latitude * COORDINATE_PRECISION);
  const textKey = text ? `:${text}` : '';
  const imageKey = image ? `:${image}` : '';

  return `${layerId}:${lon}:${lat}${textKey}${imageKey}`;
}

function resolveHorizontalCenter(x: number, origin: HorizontalOrigin, width: number): number {
  switch (origin) {
    case HorizontalOrigin.LEFT:
      return x + width * 0.5;
    case HorizontalOrigin.RIGHT:
      return x - width * 0.5;
    default:
      return x;
  }
}

function resolveVerticalCenter(y: number, origin: VerticalOrigin, height: number): number {
  switch (origin) {
    case VerticalOrigin.TOP:
      return y + height * 0.5;
    case VerticalOrigin.BOTTOM:
      return y - height * 0.5;
    default:
      return y;
  }
}

export class MvtSymbolCollisionIndex {
  private readonly grid: MvtGridIndex<CollisionKey>;
  private readonly ignoredGrid: MvtGridIndex<CollisionKey>;
  private readonly tileBoxes: TileBox[] = [];
  private readonly placedPositions: Map<string, Cartesian3[]> = new Map();
  private scene?: Scene;
  private screenWidth = 0;
  private screenHeight = 0;
  private cameraToCenterDistance = 0;
  private cameraPosition?: Cartesian3;

  constructor() {
    this.grid = new MvtGridIndex(1, 1, CELL_SIZE);
    this.ignoredGrid = new MvtGridIndex(1, 1, CELL_SIZE);
  }

  beginFrame(scene: Scene): void {
    this.scene = scene;
    this.screenWidth = scene.canvas.clientWidth;
    this.screenHeight = scene.canvas.clientHeight;

    this.updateCameraToCenterDistance();

    const gridWidth = this.screenWidth + 2 * VIEWPORT_PADDING;
    const gridHeight = this.screenHeight + 2 * VIEWPORT_PADDING;

    this.grid.reset(gridWidth, gridHeight);
    this.ignoredGrid.reset(gridWidth, gridHeight);
    this.tileBoxes.length = 0;
    this.placedPositions.clear();
  }

  hasScene(): boolean {
    return Boolean(this.scene);
  }

  isAlreadyPlaced(
    longitude: number,
    latitude: number,
    layerId: string,
    text?: string,
    image?: string,
  ): boolean {
    const crossTileID = generateCrossTileID(longitude, latitude, layerId, text, image);
    return this.placedPositions.has(crossTileID);
  }

  markAsPlaced(
    longitude: number,
    latitude: number,
    layerId: string,
    text?: string,
    image?: string,
  ): void {
    const crossTileID = generateCrossTileID(longitude, latitude, layerId, text, image);
    this.placedPositions.set(crossTileID, [new Cartesian3(longitude, latitude, 0)]);
  }

  sortPlacementsByViewportY(placements: SortablePlacement[]): SortablePlacement[] {
    if (!this.scene) {
      return placements;
    }

    return [...placements].sort((a, b) => a.screenY - b.screenY);
  }

  calculateScreenY(position: Cartesian3): number {
    if (!this.scene) {
      return 0;
    }

    const screenPosition = SceneTransforms.worldToWindowCoordinates(
      this.scene,
      position,
    );

    return screenPosition?.y ?? 0;
  }

  private updateCameraToCenterDistance(): void {
    if (!this.scene) {
      this.cameraToCenterDistance = 0;
      return;
    }

    const camera = this.scene.camera;
    this.cameraPosition = Cartesian3.clone(camera.position);

    const screenCenter = new Cartesian2(
      this.screenWidth * 0.5,
      this.screenHeight * 0.5,
    );

    const ellipsoid = this.scene.globe?.ellipsoid ?? Ellipsoid.WGS84;
    const centerOnGlobe = camera.pickEllipsoid(screenCenter, ellipsoid);

    if (centerOnGlobe) {
      this.cameraToCenterDistance = Cartesian3.distance(this.cameraPosition, centerOnGlobe);
    }
    else {
      const cameraCartographic = ellipsoid.cartesianToCartographic(this.cameraPosition);
      if (cameraCartographic) {
        this.cameraToCenterDistance = cameraCartographic.height;
      }
      else {
        this.cameraToCenterDistance = 0;
      }
    }
  }

  collides(box: MvtSymbolCollisionBox): boolean {
    if (this.scene) {
      return this.collidesScreen(box);
    }
    return this.collidesTile(box);
  }

  insert(box: MvtSymbolCollisionBox): void {
    if (this.scene) {
      this.insertScreen(box);
    }
    else {
      this.insertTile(box);
    }
  }

  private collidesTile(box: MvtSymbolCollisionBox): boolean {
    const tileBox: TileBox = {
      maxX: box.tileMaxX,
      maxY: box.tileMaxY,
      minX: box.tileMinX,
      minY: box.tileMinY,
    };
    return this.tileBoxes.some(currentBox => boxesIntersect(currentBox, tileBox));
  }

  private insertTile(box: MvtSymbolCollisionBox): void {
    this.tileBoxes.push({
      maxX: box.tileMaxX,
      maxY: box.tileMaxY,
      minX: box.tileMinX,
      minY: box.tileMinY,
    });
  }

  private collidesScreen(box: MvtSymbolCollisionBox): boolean {
    const screenPosition = SceneTransforms.worldToWindowCoordinates(
      this.scene!,
      box.position,
    );

    if (!screenPosition) {
      return false;
    }

    const perspectiveRatio = this.calculatePerspectiveRatio(box.position);
    if (perspectiveRatio < PERSPECTIVE_RATIO_CUTOFF) {
      return false;
    }

    const scaledWidth = box.width * perspectiveRatio;
    const scaledHeight = box.height * perspectiveRatio;
    const scaledPadding = box.padding * perspectiveRatio;

    const screenX = screenPosition.x + VIEWPORT_PADDING + box.pixelOffset.x * perspectiveRatio;
    const screenY = screenPosition.y + VIEWPORT_PADDING + box.pixelOffset.y * perspectiveRatio;

    const centerX = resolveHorizontalCenter(screenX, box.horizontalOrigin, scaledWidth);
    const centerY = resolveVerticalCenter(screenY, box.verticalOrigin, scaledHeight);

    const minX = centerX - scaledWidth * 0.5 - scaledPadding;
    const minY = centerY - scaledHeight * 0.5 - scaledPadding;
    const maxX = centerX + scaledWidth * 0.5 + scaledPadding;
    const maxY = centerY + scaledHeight * 0.5 + scaledPadding;

    if (!this.isInsideGrid(minX, minY, maxX, maxY)) {
      return false;
    }

    return this.grid.hitTest(minX, minY, maxX, maxY, 'never');
  }

  private insertScreen(box: MvtSymbolCollisionBox): void {
    const screenPosition = SceneTransforms.worldToWindowCoordinates(
      this.scene!,
      box.position,
    );

    if (!screenPosition) {
      return;
    }

    const perspectiveRatio = this.calculatePerspectiveRatio(box.position);
    if (perspectiveRatio < PERSPECTIVE_RATIO_CUTOFF) {
      return;
    }

    const scaledWidth = box.width * perspectiveRatio;
    const scaledHeight = box.height * perspectiveRatio;
    const scaledPadding = box.padding * perspectiveRatio;

    const screenX = screenPosition.x + VIEWPORT_PADDING + box.pixelOffset.x * perspectiveRatio;
    const screenY = screenPosition.y + VIEWPORT_PADDING + box.pixelOffset.y * perspectiveRatio;

    const centerX = resolveHorizontalCenter(screenX, box.horizontalOrigin, scaledWidth);
    const centerY = resolveVerticalCenter(screenY, box.verticalOrigin, scaledHeight);

    const minX = centerX - scaledWidth * 0.5 - scaledPadding;
    const minY = centerY - scaledHeight * 0.5 - scaledPadding;
    const maxX = centerX + scaledWidth * 0.5 + scaledPadding;
    const maxY = centerY + scaledHeight * 0.5 + scaledPadding;

    if (!this.isInsideGrid(minX, minY, maxX, maxY)) {
      return;
    }

    const key: CollisionKey = { overlapMode: 'never' };
    this.grid.insert(key, minX, minY, maxX, maxY);
  }

  placeCollisionBox(
    worldPosition: Cartesian3,
    width: number,
    height: number,
    allowOverlap: boolean,
    ignorePlacement: boolean,
  ): { box: ScreenBox | null; offscreen: boolean } {
    if (!this.scene) {
      return { box: null, offscreen: false };
    }

    const screenPosition = SceneTransforms.worldToWindowCoordinates(
      this.scene,
      worldPosition,
    );

    if (!screenPosition) {
      return { box: null, offscreen: false };
    }

    const perspectiveRatio = this.calculatePerspectiveRatio(worldPosition);
    if (perspectiveRatio < PERSPECTIVE_RATIO_CUTOFF) {
      return { box: null, offscreen: false };
    }

    const scaledWidth = width * perspectiveRatio;
    const scaledHeight = height * perspectiveRatio;

    const screenX = screenPosition.x + VIEWPORT_PADDING;
    const screenY = screenPosition.y + VIEWPORT_PADDING;

    const minX = screenX - scaledWidth / 2;
    const minY = screenY - scaledHeight / 2;
    const maxX = screenX + scaledWidth / 2;
    const maxY = screenY + scaledHeight / 2;

    if (!this.isInsideGrid(minX, minY, maxX, maxY)) {
      return { box: null, offscreen: false };
    }

    const overlapMode: OverlapMode = allowOverlap ? 'always' : 'never';

    if (!allowOverlap && !ignorePlacement) {
      if (this.grid.hitTest(minX, minY, maxX, maxY, overlapMode)) {
        return { box: null, offscreen: false };
      }
    }

    const box: ScreenBox = { maxX, maxY, minX, minY };
    return {
      box,
      offscreen: this.isOffscreen(minX, minY, maxX, maxY),
    };
  }

  insertCollisionBox(
    box: ScreenBox,
    allowOverlap: boolean,
    ignorePlacement: boolean,
  ): void {
    const overlapMode: OverlapMode = allowOverlap ? 'always' : 'never';
    const key: CollisionKey = { overlapMode };
    const grid = ignorePlacement ? this.ignoredGrid : this.grid;
    grid.insert(key, box.minX, box.minY, box.maxX, box.maxY);
  }

  private calculatePerspectiveRatio(position: Cartesian3): number {
    if (!this.scene || !this.cameraPosition) {
      return 1;
    }

    const distance = Cartesian3.distance(this.cameraPosition, position);

    if (distance <= 0 || this.cameraToCenterDistance <= 0) {
      return 1;
    }

    return 0.5 + 0.5 * (this.cameraToCenterDistance / distance);
  }

  private isInsideGrid(x1: number, y1: number, x2: number, y2: number): boolean {
    const gridRightBoundary = this.screenWidth + 2 * VIEWPORT_PADDING;
    const gridBottomBoundary = this.screenHeight + 2 * VIEWPORT_PADDING;
    return x2 >= 0 && x1 < gridRightBoundary && y2 >= 0 && y1 < gridBottomBoundary;
  }

  private isOffscreen(x1: number, y1: number, x2: number, y2: number): boolean {
    const screenRightBoundary = this.screenWidth + VIEWPORT_PADDING;
    const screenBottomBoundary = this.screenHeight + VIEWPORT_PADDING;
    return (
      x2 < VIEWPORT_PADDING
      || x1 >= screenRightBoundary
      || y2 < VIEWPORT_PADDING
      || y1 >= screenBottomBoundary
    );
  }
}

export type { SortablePlacement, ZOrderMode };
