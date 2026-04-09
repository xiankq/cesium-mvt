type OverlapMode = 'always' | 'never';

interface GridKey {
  overlapMode: OverlapMode;
}

interface QueryArgs {
  circle?: { radius: number; x: number; y: number };
  hitTest: boolean;
  overlapMode: OverlapMode;
  seenUids: { box: Record<number, boolean>; circle: Record<number, boolean> };
}

interface QueryResult<T extends GridKey> {
  key: T;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function overlapAllowed(overlapA: OverlapMode, overlapB: OverlapMode): boolean {
  if (overlapA === 'always') {
    return true;
  }
  if (overlapA === 'never' || overlapB === 'never') {
    return false;
  }
  return true;
}

export class GridIndex<T extends GridKey> {
  private boxCells: number[][];
  private cellSize: number;
  private circleCells: number[][];
  private boxKeys: T[] = [];
  private circleKeys: T[] = [];
  private bboxes: number[] = [];
  private circles: number[] = [];
  private xCellCount: number;
  private yCellCount: number;
  private xScale: number;
  private yScale: number;
  private boxUid = 0;
  private circleUid = 0;

  constructor(
    width: number,
    height: number,
    cellSize: number,
  ) {
    this.cellSize = cellSize;
    this.xCellCount = Math.ceil(width / cellSize);
    this.yCellCount = Math.ceil(height / cellSize);

    this.boxCells = [];
    this.circleCells = [];
    for (let i = 0; i < this.xCellCount * this.yCellCount; i++) {
      this.boxCells.push([]);
      this.circleCells.push([]);
    }

    this.xScale = this.xCellCount / width;
    this.yScale = this.yCellCount / height;
  }

  keysLength(): number {
    return this.boxKeys.length + this.circleKeys.length;
  }

  insert(key: T, x1: number, y1: number, x2: number, y2: number): void {
    this.forEachCellForInsert(x1, y1, x2, y2, this.boxUid);
    this.boxKeys.push(key);
    this.bboxes.push(x1, y1, x2, y2);
    this.boxUid += 1;
  }

  insertCircle(key: T, x: number, y: number, radius: number): void {
    this.forEachCellForInsert(x - radius, y - radius, x + radius, y + radius, this.circleUid);
    this.circleKeys.push(key);
    this.circles.push(x, y, radius);
    this.circleUid += 1;
  }

  query(x1: number, y1: number, x2: number, y2: number): QueryResult<T>[] {
    return this.queryInternal(x1, y1, x2, y2, false, 'never');
  }

  hitTest(x1: number, y1: number, x2: number, y2: number, overlapMode: OverlapMode): boolean {
    return this.queryInternal(x1, y1, x2, y2, true, overlapMode).length > 0;
  }

  hitTestCircle(x: number, y: number, radius: number, overlapMode: OverlapMode): boolean {
    const x1 = x - radius;
    const x2 = x + radius;
    const y1 = y - radius;
    const y2 = y + radius;

    if (x2 < 0 || x1 > this.xCellCount * this.cellSize || y2 < 0 || y1 > this.yCellCount * this.cellSize) {
      return false;
    }

    const result: boolean[] = [];
    const queryArgs: QueryArgs = {
      circle: { radius, x, y },
      hitTest: true,
      overlapMode,
      seenUids: { box: {}, circle: {} },
    };
    this.forEachCellForQuery(x1, y1, x2, y2, result, queryArgs);
    return result.length > 0;
  }

  reset(width: number, height: number): void {
    this.xCellCount = Math.ceil(width / this.cellSize);
    this.yCellCount = Math.ceil(height / this.cellSize);
    this.xScale = this.xCellCount / width;
    this.yScale = this.yCellCount / height;

    this.boxCells = [];
    this.circleCells = [];
    for (let i = 0; i < this.xCellCount * this.yCellCount; i++) {
      this.boxCells.push([]);
      this.circleCells.push([]);
    }

    this.boxKeys = [];
    this.circleKeys = [];
    this.bboxes = [];
    this.circles = [];
    this.boxUid = 0;
    this.circleUid = 0;
  }

  private queryInternal(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    hitTest: boolean,
    overlapMode: OverlapMode,
  ): QueryResult<T>[] {
    const width = this.xCellCount * this.cellSize;
    const height = this.yCellCount * this.cellSize;

    if (x2 < 0 || x1 > width || y2 < 0 || y1 > height) {
      return [];
    }

    const result: QueryResult<T>[] = [];
    if (x1 <= 0 && y1 <= 0 && width <= x2 && height <= y2) {
      if (hitTest) {
        return [{ key: null as unknown as T, x1, x2, y1, y2 }];
      }
      for (let boxUid = 0; boxUid < this.boxKeys.length; boxUid++) {
        result.push({
          key: this.boxKeys[boxUid],
          x1: this.bboxes[boxUid * 4],
          y1: this.bboxes[boxUid * 4 + 1],
          x2: this.bboxes[boxUid * 4 + 2],
          y2: this.bboxes[boxUid * 4 + 3],
        });
      }
      for (let circleUid = 0; circleUid < this.circleKeys.length; circleUid++) {
        const cx = this.circles[circleUid * 3];
        const cy = this.circles[circleUid * 3 + 1];
        const r = this.circles[circleUid * 3 + 2];
        result.push({
          key: this.circleKeys[circleUid],
          x1: cx - r,
          y1: cy - r,
          x2: cx + r,
          y2: cy + r,
        });
      }
    }
    else {
      const queryArgs: QueryArgs = {
        hitTest,
        overlapMode,
        seenUids: { box: {}, circle: {} },
      };
      this.forEachCellForQuery(x1, y1, x2, y2, result, queryArgs);
    }

    return result;
  }

  private forEachCellForInsert(x1: number, y1: number, x2: number, y2: number, uid: number): void {
    const cx1 = this.convertToXCellCoord(x1);
    const cy1 = this.convertToYCellCoord(y1);
    const cx2 = this.convertToXCellCoord(x2);
    const cy2 = this.convertToYCellCoord(y2);

    for (let x = cx1; x <= cx2; x++) {
      for (let y = cy1; y <= cy2; y++) {
        const cellIndex = this.xCellCount * y + x;
        this.insertBoxCell(cellIndex, uid);
      }
    }
  }

  private forEachCellForQuery(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    result: QueryResult<T>[],
    queryArgs: QueryArgs,
  ): void;
  private forEachCellForQuery(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    result: boolean[],
    queryArgs: QueryArgs,
  ): void;
  private forEachCellForQuery(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    result: QueryResult<T>[] | boolean[],
    queryArgs: QueryArgs,
  ): void {
    const cx1 = this.convertToXCellCoord(x1);
    const cy1 = this.convertToYCellCoord(y1);
    const cx2 = this.convertToXCellCoord(x2);
    const cy2 = this.convertToYCellCoord(y2);

    for (let x = cx1; x <= cx2; x++) {
      for (let y = cy1; y <= cy2; y++) {
        const cellIndex = this.xCellCount * y + x;
        if (Array.isArray(result) && typeof result[0] === 'boolean') {
          if (this.queryCellCircle(cellIndex, result as boolean[], queryArgs)) {
            return;
          }
        }
        else {
          if (this.queryCell(cellIndex, result as QueryResult<T>[], queryArgs)) {
            return;
          }
        }
      }
    }
  }

  private insertBoxCell(cellIndex: number, uid: number): void {
    this.boxCells[cellIndex].push(uid);
  }

  private queryCell(
    cellIndex: number,
    result: QueryResult<T>[],
    queryArgs: QueryArgs,
  ): boolean {
    const { seenUids, hitTest, overlapMode } = queryArgs;
    const boxCell = this.boxCells[cellIndex];

    if (boxCell.length > 0) {
      for (const boxUid of boxCell) {
        if (seenUids.box[boxUid]) {
          continue;
        }
        seenUids.box[boxUid] = true;
        const offset = boxUid * 4;
        const key = this.boxKeys[boxUid];
        const boxX1 = this.bboxes[offset];
        const boxY1 = this.bboxes[offset + 1];
        const boxX2 = this.bboxes[offset + 2];
        const boxY2 = this.bboxes[offset + 3];

        if (!hitTest || !overlapAllowed(overlapMode, key.overlapMode)) {
          result.push({
            key,
            x1: boxX1,
            y1: boxY1,
            x2: boxX2,
            y2: boxY2,
          });
          if (hitTest) {
            return true;
          }
        }
      }
    }

    const circleCell = this.circleCells[cellIndex];
    if (circleCell.length > 0) {
      for (const circleUid of circleCell) {
        if (seenUids.circle[circleUid]) {
          continue;
        }
        seenUids.circle[circleUid] = true;
        const offset = circleUid * 3;
        const key = this.circleKeys[circleUid];
        const cx = this.circles[offset];
        const cy = this.circles[offset + 1];
        const r = this.circles[offset + 2];

        if (!hitTest || !overlapAllowed(overlapMode, key.overlapMode)) {
          result.push({
            key,
            x1: cx - r,
            y1: cy - r,
            x2: cx + r,
            y2: cy + r,
          });
          if (hitTest) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private queryCellCircle(
    cellIndex: number,
    result: boolean[],
    queryArgs: QueryArgs,
  ): boolean {
    const { circle, seenUids, overlapMode } = queryArgs;
    const boxCell = this.boxCells[cellIndex];

    if (boxCell.length > 0) {
      for (const boxUid of boxCell) {
        if (seenUids.box[boxUid]) {
          continue;
        }
        seenUids.box[boxUid] = true;
        const offset = boxUid * 4;
        const key = this.boxKeys[boxUid];
        if (
          this.circleAndRectCollide(
            circle!.x,
            circle!.y,
            circle!.radius,
            this.bboxes[offset],
            this.bboxes[offset + 1],
            this.bboxes[offset + 2],
            this.bboxes[offset + 3],
          )
          && !overlapAllowed(overlapMode, key.overlapMode)
        ) {
          result.push(true);
          return true;
        }
      }
    }

    const circleCell = this.circleCells[cellIndex];
    if (circleCell.length > 0) {
      for (const circleUid of circleCell) {
        if (seenUids.circle[circleUid]) {
          continue;
        }
        seenUids.circle[circleUid] = true;
        const offset = circleUid * 3;
        const key = this.circleKeys[circleUid];
        if (
          this.circlesCollide(
            this.circles[offset],
            this.circles[offset + 1],
            this.circles[offset + 2],
            circle!.x,
            circle!.y,
            circle!.radius,
          )
          && !overlapAllowed(overlapMode, key.overlapMode)
        ) {
          result.push(true);
          return true;
        }
      }
    }

    return false;
  }

  private convertToXCellCoord(x: number): number {
    return Math.max(0, Math.min(this.xCellCount - 1, Math.floor(x * this.xScale)));
  }

  private convertToYCellCoord(y: number): number {
    return Math.max(0, Math.min(this.yCellCount - 1, Math.floor(y * this.yScale)));
  }

  private circlesCollide(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const bothRadii = r1 + r2;
    return bothRadii * bothRadii > dx * dx + dy * dy;
  }

  private circleAndRectCollide(
    circleX: number,
    circleY: number,
    radius: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): boolean {
    const halfRectWidth = (x2 - x1) / 2;
    const distX = Math.abs(circleX - (x1 + halfRectWidth));
    if (distX > halfRectWidth + radius) {
      return false;
    }

    const halfRectHeight = (y2 - y1) / 2;
    const distY = Math.abs(circleY - (y1 + halfRectHeight));
    if (distY > halfRectHeight + radius) {
      return false;
    }

    if (distX <= halfRectWidth || distY <= halfRectHeight) {
      return true;
    }

    const dx = distX - halfRectWidth;
    const dy = distY - halfRectHeight;
    return dx * dx + dy * dy <= radius * radius;
  }
}
