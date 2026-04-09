export interface TileBlockers {
  parsing: boolean;
  pick: boolean;
  placement: boolean;
  requesting: boolean;
  uploading: boolean;
}

export interface TileSnapshot {
  blockers: TileBlockers;
  eligibleForUnloading: boolean;
  key: string;
  state: TileState;
}

export interface TileFrameResult {
  hiddenKeys: string[];
  unloadableKeys: string[];
}

export type TileState = 'hidden' | 'idle' | 'shown';

interface TileRecord extends TileSnapshot {
  candidateThisFrame: boolean;
  selectedThisFrame: boolean;
  shownThisFrame: boolean;
  touchedThisFrame: boolean;
}

const DEFAULT_BLOCKERS: TileBlockers = {
  parsing: false,
  pick: false,
  placement: false,
  requesting: false,
  uploading: false,
};

// TileManager 显式维护逐帧状态：shown、hidden、touched、unloadable
// 是刻意拆开的概念，避免 cache trim 误伤仍在承担 fallback 的瓦片。
export class TileManager {
  private currentFrame = 0;
  private readonly tiles = new Map<string, TileRecord>();

  beginFrame(frameNumber = this.currentFrame + 1) {
    this.currentFrame = frameNumber;
    for (const tile of this.tiles.values()) {
      tile.candidateThisFrame = false;
      tile.selectedThisFrame = false;
      tile.shownThisFrame = false;
      tile.touchedThisFrame = false;
    }
  }

  markCandidate(key: string) {
    this.getOrCreateTile(key).candidateThisFrame = true;
  }

  markSelected(key: string) {
    const tile = this.getOrCreateTile(key);
    tile.candidateThisFrame = true;
    tile.selectedThisFrame = true;
  }

  markShown(key: string) {
    const tile = this.getOrCreateTile(key);
    tile.candidateThisFrame = true;
    tile.selectedThisFrame = true;
    tile.shownThisFrame = true;
    tile.touchedThisFrame = true;
  }

  touch(key: string) {
    this.getOrCreateTile(key).touchedThisFrame = true;
  }

  setBlockers(key: string, blockers: Partial<TileBlockers>) {
    const tile = this.getOrCreateTile(key);
    tile.blockers = {
      ...tile.blockers,
      ...blockers,
    };
  }

  endFrame(): TileFrameResult {
    const hiddenKeys: string[] = [];
    const unloadableKeys: string[] = [];

    for (const tile of this.tiles.values()) {
      if (tile.shownThisFrame) {
        tile.state = 'shown';
      }
      else if (tile.state === 'shown') {
        // 退出 show 集时先转成 hidden，由调用方决定后续是否真正卸载。
        tile.state = 'hidden';
        hiddenKeys.push(tile.key);
      }

      tile.eligibleForUnloading
        = !tile.touchedThisFrame && !hasBlockers(tile.blockers);

      if (tile.eligibleForUnloading) {
        unloadableKeys.push(tile.key);
      }
    }

    return {
      hiddenKeys,
      unloadableKeys,
    };
  }

  getCurrentFrame() {
    return this.currentFrame;
  }

  getTile(key: string): TileSnapshot | undefined {
    const tile = this.tiles.get(key);
    if (!tile) {
      return undefined;
    }

    return {
      blockers: { ...tile.blockers },
      eligibleForUnloading: tile.eligibleForUnloading,
      key: tile.key,
      state: tile.state,
    };
  }

  private getOrCreateTile(key: string) {
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = {
        blockers: { ...DEFAULT_BLOCKERS },
        candidateThisFrame: false,
        eligibleForUnloading: false,
        key,
        selectedThisFrame: false,
        shownThisFrame: false,
        state: 'idle',
        touchedThisFrame: false,
      };
      this.tiles.set(key, tile);
    }

    return tile;
  }
}

function hasBlockers(blockers: TileBlockers) {
  return Object.values(blockers).some(Boolean);
}
