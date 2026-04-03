export class TileImageCache {
  private readonly images = new Map<string, HTMLCanvasElement>()

  get(
    width = 256,
    height = 256,
    fillStyle?: string,
  ): HTMLCanvasElement {
    const key = `${width}x${height}:${fillStyle ?? 'transparent'}`
    const cached = this.images.get(key)
    if (cached) {
      return cached
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (context) {
      context.clearRect(0, 0, width, height)
      if (fillStyle) {
        context.fillStyle = fillStyle
        context.fillRect(0, 0, width, height)
      }
    }

    this.images.set(key, canvas)
    return canvas
  }

  clear(): void {
    this.images.clear()
  }
}
