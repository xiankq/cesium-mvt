declare module '@mapbox/whoots-js' {
  export function getMercCoords(
    longitude: number,
    latitude: number,
  ): [number, number];

  export function getTileBBox(
    x: number,
    y: number,
    z: number,
  ): string;

  export function getURL(
    baseUrl: string,
    layer: string,
    x: number,
    y: number,
    z: number,
    options?: Record<string, unknown>,
  ): string;
}
