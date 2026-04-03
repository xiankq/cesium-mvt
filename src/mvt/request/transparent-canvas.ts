const transparentCanvases = new Map<string, HTMLCanvasElement>()

export function createTransparentCanvas(
  width = 256,
  height = 256,
): HTMLCanvasElement {
  const key = `${width}x${height}`
  const cached = transparentCanvases.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, width, height)
  }

  transparentCanvases.set(key, canvas)
  return canvas
}
