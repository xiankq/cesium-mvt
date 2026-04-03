export type ScreenRect = {
  left: number
  top: number
  right: number
  bottom: number
}

function toCellKey(x: number, y: number): string {
  return `${x}:${y}`
}

function clampFloor(value: number): number {
  return Math.floor(Number.isFinite(value) ? value : 0)
}

export function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function collectScreenGridKeys(
  rect: ScreenRect,
  cellSize: number,
): string[] {
  const size = Math.max(16, cellSize)
  const minX = clampFloor(Math.min(rect.left, rect.right) / size)
  const maxX = clampFloor(Math.max(rect.left, rect.right) / size)
  const minY = clampFloor(Math.min(rect.top, rect.bottom) / size)
  const maxY = clampFloor(Math.max(rect.top, rect.bottom) / size)

  const keys: string[] = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      keys.push(toCellKey(x, y))
    }
  }

  return keys
}
