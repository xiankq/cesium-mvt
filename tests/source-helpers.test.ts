import { describe, expect, it } from 'vitest';
import { buildSceneViewSignature, getRenderedSurfaceTiles, normalizeVisibleTileCover } from '../src/mvt/scheduler/source';

describe('normalizeVisibleTileCover', () => {
  it('keeps the parent tile when child coverage is partial', () => {
    const sourceId = 'source';
    const normalized = normalizeVisibleTileCover(
      sourceId,
      [
        { x: 0, y: 0, level: 0 },
        { x: 0, y: 0, level: 1 },
      ],
      0,
    );

    expect(Array.from(normalized.keys())).toEqual([
      `${sourceId}:0/0/0`,
    ]);
  });

  it('switches to children once the parent area is fully covered', () => {
    const sourceId = 'source';
    const normalized = normalizeVisibleTileCover(
      sourceId,
      [
        { x: 0, y: 0, level: 0 },
        { x: 0, y: 0, level: 1 },
        { x: 1, y: 0, level: 1 },
        { x: 0, y: 1, level: 1 },
        { x: 1, y: 1, level: 1 },
      ],
      0,
    );

    expect(Array.from(normalized.keys()).sort()).toEqual([
      `${sourceId}:1/0/0`,
      `${sourceId}:1/0/1`,
      `${sourceId}:1/1/0`,
      `${sourceId}:1/1/1`,
    ]);
  });
});

describe('buildSceneViewSignature', () => {
  const createScene = (x: number, heading = 0.25) =>
    ({
      camera: {
        position: { x, y: 2, z: 3 },
        positionWC: { x, y: 2, z: 3 },
        heading,
        pitch: 0.1,
        roll: -0.2,
      },
    }) as Parameters<typeof buildSceneViewSignature>[0];

  it('ignores sub-threshold camera drift', () => {
    expect(buildSceneViewSignature(createScene(1))).toBe(
      buildSceneViewSignature(createScene(1.24)),
    );
  });

  it('changes once the camera movement becomes meaningful', () => {
    expect(buildSceneViewSignature(createScene(1))).not.toBe(
      buildSceneViewSignature(createScene(1.6)),
    );
    expect(buildSceneViewSignature(createScene(1))).not.toBe(
      buildSceneViewSignature(createScene(1, 0.2502)),
    );
  });
});

describe('getRenderedSurfaceTiles', () => {
  it('returns undefined when Cesium private surface state is unavailable', () => {
    expect(
      getRenderedSurfaceTiles({
        globe: {},
      } as Parameters<typeof getRenderedSurfaceTiles>[0]),
    ).toBeUndefined();
  });

  it('returns the rendered tile list when the private surface state exists', () => {
    const renderedTiles = [
      {
        data: {
          imagery: [],
        },
      },
    ];

    expect(
      getRenderedSurfaceTiles({
        globe: {
          _surface: {
            _tilesToRender: renderedTiles,
          },
        },
      } as Parameters<typeof getRenderedSurfaceTiles>[0]),
    ).toBe(renderedTiles);
  });
});
