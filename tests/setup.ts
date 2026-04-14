function defineDomConstructor(name: string) {
  if (typeof globalThis[name as keyof typeof globalThis] === 'undefined') {
    class DomConstructor {}
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: DomConstructor,
      writable: true,
    });
  }
}

defineDomConstructor('HTMLCanvasElement');
defineDomConstructor('HTMLImageElement');
defineDomConstructor('ImageBitmap');
defineDomConstructor('OffscreenCanvas');

export {};
