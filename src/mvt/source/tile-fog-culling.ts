export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface IsTileVisibleThroughFogOptions {
  cameraPosition: Vector3;
  tileCenter: Vector3;
  tileRadius: number;
  fogMaximumDistance: number;
}

export function isTileVisibleThroughFog({
  cameraPosition,
  tileCenter,
  tileRadius,
  fogMaximumDistance,
}: IsTileVisibleThroughFogOptions): boolean {
  const distance = Math.sqrt(
    (tileCenter.x - cameraPosition.x) ** 2
    + (tileCenter.y - cameraPosition.y) ** 2
    + (tileCenter.z - cameraPosition.z) ** 2,
  );

  return distance <= fogMaximumDistance + tileRadius;
}
