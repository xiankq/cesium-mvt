/* eslint-disable ts/method-signature-style */
declare module 'cesium' {
  interface PrimitiveCollection {
    update(frameState: unknown): void;
    prePassesUpdate(frameState: unknown): void;
  }
}
