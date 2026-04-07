import type { UrlTemplateContext } from '../types';
import { Rectangle } from 'cesium';

const DEFAULT_SUBDOMAINS = ['a', 'b', 'c'];

function normalizeSubdomains(subdomains?: string | string[]): string[] {
  if (Array.isArray(subdomains))
    return subdomains.slice();
  if (typeof subdomains === 'string' && subdomains.length > 0) {
    return subdomains.split('');
  }
  return DEFAULT_SUBDOMAINS;
}

function selectSubdomain(subdomains: string[], x: number, y: number, level: number): string {
  if (subdomains.length === 0)
    return '';
  return subdomains[Math.abs(x + y + level) % subdomains.length];
}

function pad(value: number, padding: number | undefined): string {
  if (!padding)
    return String(value);
  return String(value).padStart(padding, '0');
}

function getPadding(
  token: string,
  paddingMap: Record<string, string> | undefined,
): number | undefined {
  const p = paddingMap?.[token];
  return p ? p.length : undefined;
}

function replaceTokens(template: string, context: UrlTemplateContext): string {
  const tilesX = context.tilingScheme.getNumberOfXTilesAtLevel(context.level);
  const tilesY = context.tilingScheme.getNumberOfYTilesAtLevel(context.level);
  const zeroPad = context.urlSchemeZeroPadding;
  const deg = (rad: number) => String((rad * 180) / Math.PI);

  const replacements: Record<string, string> = {
    z: pad(context.level, getPadding('{z}', zeroPad)),
    x: pad(context.x, getPadding('{x}', zeroPad)),
    y: pad(context.y, getPadding('{y}', zeroPad)),
    reverseX: pad(tilesX - context.x - 1, getPadding('{reverseX}', zeroPad)),
    reverseY: pad(tilesY - context.y - 1, getPadding('{reverseY}', zeroPad)),
    reverseZ: pad(
      context.maximumLevel !== undefined ? context.maximumLevel - context.level : context.level,
      getPadding('{reverseZ}', zeroPad),
    ),
    westDegrees: deg(context.rectangle.west),
    southDegrees: deg(context.rectangle.south),
    eastDegrees: deg(context.rectangle.east),
    northDegrees: deg(context.rectangle.north),
    westProjected: String(context.nativeRectangle.west),
    southProjected: String(context.nativeRectangle.south),
    eastProjected: String(context.nativeRectangle.east),
    northProjected: String(context.nativeRectangle.north),
    width: String(context.tileWidth),
    height: String(context.tileHeight),
    s: selectSubdomain(context.subdomains, context.x, context.y, context.level),
  };

  return template.replace(/\{(\w+)\}/g, (match, rawName: string) => {
    const token = String(rawName);

    if (context.customTags?.[token]) {
      try {
        return context.customTags[token](context);
      }
      catch (error) {
        console.warn(
          `[cesium-mvt] Custom tag "${token}" threw an error; keeping original token.`,
          error,
        );
        return match;
      }
    }

    const replacement = replacements[token];
    return replacement ?? match;
  });
}

export function buildTileUrl(
  template: string,
  context: Omit<UrlTemplateContext, 'rectangle' | 'nativeRectangle' | 'subdomains'> & {
    subdomains?: string | string[];
  },
): string {
  const rectangle = context.tilingScheme.tileXYToRectangle(context.x, context.y, context.level);
  const nativeRectangle = context.tilingScheme.rectangleToNativeRectangle(
    Rectangle.clone(rectangle),
  );

  return replaceTokens(template, {
    ...context,
    rectangle,
    nativeRectangle,
    subdomains: normalizeSubdomains(context.subdomains),
  });
}
