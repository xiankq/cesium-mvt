export interface Plane {
  normal: { x: number; y: number; z: number };
  distance: number;
}

export interface BoundingSphere {
  center: { x: number; y: number; z: number };
  radius: number;
}

export interface IsTileVisibleInFrustumOptions {
  frustumPlanes: Plane[];
  tileBoundingSphere: BoundingSphere;
}

export function isTileVisibleInFrustum({
  frustumPlanes,
  tileBoundingSphere,
}: IsTileVisibleInFrustumOptions): boolean {
  const { center, radius } = tileBoundingSphere;

  for (const plane of frustumPlanes) {
    const distance
      = plane.normal.x * center.x
        + plane.normal.y * center.y
        + plane.normal.z * center.z
        + plane.distance;

    if (distance < -radius) {
      return false;
    }
  }

  return true;
}
