export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface IsTileVisibleAboveHorizonOptions {
  cameraPosition: Vector3;
  tileCenter: Vector3;
  tileRadius: number;
  ellipsoidRadii: Vector3;
}

export function isTileVisibleAboveHorizon({
  cameraPosition,
  tileCenter,
  tileRadius,
  ellipsoidRadii,
}: IsTileVisibleAboveHorizonOptions): boolean {
  const cameraDistance = Math.sqrt(
    cameraPosition.x ** 2
    + cameraPosition.y ** 2
    + cameraPosition.z ** 2,
  );

  const ellipsoidRadius = Math.sqrt(
    ellipsoidRadii.x ** 2
    + ellipsoidRadii.y ** 2
    + ellipsoidRadii.z ** 2,
  )
  / Math.sqrt(3);

  const horizonDistance = Math.sqrt(
    cameraDistance ** 2 - ellipsoidRadius ** 2,
  );

  const tileDistance = Math.sqrt(
    (tileCenter.x - cameraPosition.x) ** 2
    + (tileCenter.y - cameraPosition.y) ** 2
    + (tileCenter.z - cameraPosition.z) ** 2,
  );

  const tileHeight = Math.sqrt(
    tileCenter.x ** 2
    + tileCenter.y ** 2
    + tileCenter.z ** 2,
  )
  - ellipsoidRadius;

  if (tileHeight > 0) {
    return true;
  }

  if (tileDistance <= horizonDistance + tileRadius) {
    return true;
  }

  return false;
}
