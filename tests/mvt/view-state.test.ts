import {
  Rectangle,
  WebMercatorTilingScheme,
} from 'cesium';
import { describe, expect, it } from 'vitest';
import {
  collectCoveringTileCoordinates,
  estimateViewTileLevel,
} from '@/mvt/source/view-state';

describe('view-state', () => {
  it('estimates tile level from the current view width and clamps to configured limits', () => {
    const tilingScheme = new WebMercatorTilingScheme();

    expect(estimateViewTileLevel({
      maximumLevel: 6,
      minimumLevel: 0,
      tileWidth: 256,
      tilingScheme,
      viewRectangle: tilingScheme.rectangle,
      viewportWidth: 256,
    })).toBe(0);

    expect(estimateViewTileLevel({
      maximumLevel: 6,
      minimumLevel: 0,
      tileWidth: 256,
      tilingScheme,
      viewRectangle: Rectangle.fromDegrees(-45, -20, 45, 20),
      viewportWidth: 256,
    })).toBe(2);

    expect(estimateViewTileLevel({
      maximumLevel: 1,
      minimumLevel: 1,
      tileWidth: 256,
      tilingScheme,
      viewRectangle: Rectangle.fromDegrees(-45, -20, 45, 20),
      viewportWidth: 1024,
    })).toBe(1);
  });

  it('collects all tiles that cover the current view rectangle at the target level', () => {
    const tilingScheme = new WebMercatorTilingScheme();

    expect(collectCoveringTileCoordinates({
      level: 2,
      rectangle: Rectangle.fromDegrees(-10, -10, 10, 10),
      tilingScheme,
    })).toEqual([
      { level: 2, x: 1, y: 1 },
      { level: 2, x: 2, y: 1 },
      { level: 2, x: 1, y: 2 },
      { level: 2, x: 2, y: 2 },
    ]);
  });
});
