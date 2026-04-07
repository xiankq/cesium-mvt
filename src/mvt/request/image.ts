export class TileImageCache {
  private readonly images = new Map<string, HTMLCanvasElement>();

  get(
    width = 256,
    height = 256,
    fillStyle?: string,
  ): HTMLCanvasElement {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const key = `${safeWidth}x${safeHeight}:${fillStyle ?? 'transparent'}`;
    const cached = this.images.get(key);
    if (cached) {
      return cached;
    }

    const canvas = document.createElement('canvas');
    canvas.width = safeWidth;
    canvas.height = safeHeight;

    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, safeWidth, safeHeight);
      if (fillStyle) {
        context.fillStyle = fillStyle;
        context.fillRect(0, 0, safeWidth, safeHeight);
      }
    }

    this.images.set(key, canvas);
    return canvas;
  }

  clear(): void {
    this.images.clear();
  }
}
