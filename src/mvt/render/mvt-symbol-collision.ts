export interface MvtSymbolCollisionBox {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export class MvtSymbolCollisionIndex {
  private readonly boxes: MvtSymbolCollisionBox[] = [];

  collides(box: MvtSymbolCollisionBox): boolean {
    return this.boxes.some(currentBox => boxesIntersect(currentBox, box));
  }

  insert(box: MvtSymbolCollisionBox): void {
    this.boxes.push(box);
  }

  reset(): void {
    this.boxes.length = 0;
  }
}

function boxesIntersect(left: MvtSymbolCollisionBox, right: MvtSymbolCollisionBox): boolean {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minY <= right.maxY
    && left.maxY >= right.minY;
}
