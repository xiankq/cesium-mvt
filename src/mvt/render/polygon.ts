import type {
  Color,
  TilingScheme,
} from 'cesium';
import type {
  DecodedFeatureRecord,
  DecodedTileRecord,
} from '../types';
import type { TileTransformContext } from './geometry';
import { ColorGeometryInstanceAttribute, GeometryInstance, PerInstanceColorAppearance, PolygonGeometry, PolygonHierarchy } from 'cesium';
import { createTileTransformContext, ensureClosedLoop, groupPolygonRings, toCartesianPositionsWithContext } from './geometry';

export interface RenderPolygonPrimitivesOptions {
  tilingScheme: TilingScheme;
  tile: DecodedTileRecord;
  extent: number;
  layerId: string;
  feature: DecodedFeatureRecord;
  instances: GeometryInstance[];
  color: Color;
  transformContext?: TileTransformContext;
}

export function renderPolygonPrimitives(
  options: RenderPolygonPrimitivesOptions,
): number {
  const {
    tilingScheme,
    tile,
    extent,
    layerId,
    feature,
    instances,
    color,
    transformContext,
  } = options;

  const resolvedTransformContext
    = transformContext
      ?? createTileTransformContext(
        tilingScheme,
        tile.coord,
        extent,
      );
  let count = 0;
  for (const polygon of groupPolygonRings(feature.geometry)) {
    const outerPositions = toCartesianPositionsWithContext(
      resolvedTransformContext,
      polygon.outer,
    );
    if (outerPositions.length < 3) {
      continue;
    }

    const holes = polygon.holes
      .map(ring =>
        toCartesianPositionsWithContext(resolvedTransformContext, ring),
      )
      .filter(positions => positions.length >= 3)
      .map(positions => new PolygonHierarchy(ensureClosedLoop(positions)));

    const geometry = new PolygonGeometry({
      polygonHierarchy: new PolygonHierarchy(
        ensureClosedLoop(outerPositions),
        holes,
      ),
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    });

    instances.push(
      new GeometryInstance({
        geometry,
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(color),
        },
        id: {
          tileId: tile.id,
          layer: layerId,
          featureId: feature.id,
        },
      }),
    );

    count += 1;
  }

  return count;
}
