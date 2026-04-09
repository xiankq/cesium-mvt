import type { FeatureTile } from '../render/feature-tile';
import type { RenderTile } from '../render/render-tile';
import { compileFeatureTile } from '../render/feature-tile';
import { parseVectorTile } from '../source/vector-tile';

export interface CompileFeatureTileFromDataOptions {
  renderTile: RenderTile;
  tileData: ArrayBuffer;
}

export function compileFeatureTileFromData({
  renderTile,
  tileData,
}: CompileFeatureTileFromDataOptions): FeatureTile {
  return compileFeatureTile({
    renderTile,
    tile: parseVectorTile(tileData),
  });
}
