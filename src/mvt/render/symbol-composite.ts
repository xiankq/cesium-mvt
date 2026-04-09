import type { StyleSpriteAtlas } from '../types';
import type { ResolvedSymbolIcon, ResolvedSymbolLabel } from './symbol-types';

export interface CompositeSpriteEntry {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CompositeSpriteAtlas {
  entries: Map<string, CompositeSpriteEntry>;
  image: HTMLCanvasElement;
  imageUrl: string;
}

export type CompositeSpriteCache = WeakMap<ResolvedSymbolLabel, Map<string, CompositeSpriteEntry>>;

export interface CompositeSpriteItem {
  entry: CompositeSpriteEntry;
  icon: ResolvedSymbolIcon;
  key: string;
  label: ResolvedSymbolLabel;
}

export function createCompositeSpriteCache(): CompositeSpriteCache {
  return new WeakMap<ResolvedSymbolLabel, Map<string, CompositeSpriteEntry>>();
}

export function createCompositeCacheKey(
  icon: ResolvedSymbolIcon,
  fit: string,
  padding: [number, number, number, number],
): string {
  return `${icon.image}:${icon.width}:${icon.height}:${fit}:${padding.join(',')}`;
}

export function getOrCreateCompositeSpriteEntry(
  icon: ResolvedSymbolIcon,
  label: ResolvedSymbolLabel,
  cache: CompositeSpriteCache,
  fit: string,
  padding: [number, number, number, number],
): CompositeSpriteEntry | undefined {
  let labelCache = cache.get(label);
  if (!labelCache) {
    labelCache = new Map();
    cache.set(label, labelCache);
  }

  const cacheKey = createCompositeCacheKey(icon, fit, padding);
  const cached = labelCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [top, right, bottom, left] = padding;
  const textWidth = label.blockWidth + left + right;
  const textHeight = label.blockHeight + top + bottom;

  let width = icon.width;
  let height = icon.height;

  switch (fit) {
    case 'width':
      width = textWidth;
      break;
    case 'height':
      height = textHeight;
      break;
    case 'both':
      width = textWidth;
      height = textHeight;
      break;
    default:
      return undefined;
  }

  const entry: CompositeSpriteEntry = {
    height,
    width,
    x: 0,
    y: 0,
  };

  labelCache.set(cacheKey, entry);
  return entry;
}

export function buildCompositeSpriteAtlas(
  items: readonly CompositeSpriteItem[],
  atlas: StyleSpriteAtlas,
): CompositeSpriteAtlas {
  const totalArea = items.reduce((sum, item) => sum + item.entry.width * item.entry.height, 0);
  const estimatedSize = Math.ceil(Math.sqrt(totalArea));
  const canvasSize = Math.max(256, nextPowerOfTwo(estimatedSize));

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context for composite sprite atlas');
  }

  const entries = new Map<string, CompositeSpriteEntry>();
  let currentX = 0;
  let currentY = 0;
  let rowHeight = 0;

  for (const item of items) {
    const { entry, icon, key, label } = item;
    const { width, height } = entry;

    if (currentX + width > canvasSize) {
      currentX = 0;
      currentY += rowHeight;
      rowHeight = 0;
    }

    if (currentY + height > canvasSize) {
      console.warn('Composite sprite atlas overflow, some items will be skipped');
      break;
    }

    ctx.drawImage(
      atlas.image,
      icon.imageSubRegion.x,
      icon.imageSubRegion.y,
      icon.imageSubRegion.width,
      icon.imageSubRegion.height,
      currentX,
      currentY,
      width,
      height,
    );

    const [top, right, bottom, left] = [0, 0, 0, 0];
    ctx.font = label.font;
    ctx.fillStyle = `rgba(${Math.round(label.fillColor.red * 255)}, ${Math.round(label.fillColor.green * 255)}, ${Math.round(label.fillColor.blue * 255)}, ${label.fillColor.alpha})`;
    ctx.textAlign = getCanvasTextAlign(label.horizontalOrigin);
    ctx.textBaseline = getCanvasTextBaseline(label.verticalOrigin);

    const textX = currentX + width / 2 + left - right;
    const lineHeight = label.lineHeight;
    const totalHeight = label.lines.length * lineHeight;
    const startY = currentY + (height - totalHeight) / 2 + top - bottom + lineHeight / 2;

    label.lines.forEach((line: string, index: number) => {
      const y = startY + index * lineHeight;
      if (label.outlineWidth > 0) {
        ctx.strokeStyle = `rgba(${Math.round(label.outlineColor.red * 255)}, ${Math.round(label.outlineColor.green * 255)}, ${Math.round(label.outlineColor.blue * 255)}, ${label.outlineColor.alpha})`;
        ctx.lineWidth = label.outlineWidth * 2;
        ctx.strokeText(line, textX, y);
      }
      ctx.fillText(line, textX, y);
    });

    entries.set(key, {
      height,
      width,
      x: currentX,
      y: currentY,
    });

    currentX += width;
    rowHeight = Math.max(rowHeight, height);
  }

  return {
    entries,
    image: canvas,
    imageUrl: canvas.toDataURL(),
  };
}

function nextPowerOfTwo(n: number): number {
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

function getCanvasTextAlign(horizontalOrigin: number): CanvasTextAlign {
  switch (horizontalOrigin) {
    case 0:
      return 'center';
    case 1:
      return 'left';
    case -1:
      return 'right';
    default:
      return 'center';
  }
}

function getCanvasTextBaseline(verticalOrigin: number): CanvasTextBaseline {
  switch (verticalOrigin) {
    case 0:
      return 'middle';
    case 1:
      return 'bottom';
    case -1:
      return 'top';
    default:
      return 'middle';
  }
}
