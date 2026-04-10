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
    tile.eligibleForUnloading = false;
  }

  markShown(key: string) {
    const tile = this.getOrCreateTile(key);
    tile.candidateThisFrame = true;
    tile.eligibleForUnloading = false;
    tile.selectedThisFrame = true;
    tile.state = 'shown';
    tile.shownThisFrame = true;
    tile.touchedThisFrame = true;
  }

  touch(key: string) {
    const tile = this.getOrCreateTile(key);
    tile.eligibleForUnloading = false;
    tile.touchedThisFrame = true;
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
        tile.eligibleForUnloading = false;
      }
      else if (tile.state === 'shown') {
        // 退出 show 集时先转成 hidden，由调用方决定后续是否真正卸载。
        tile.state = 'hidden';
        tile.eligibleForUnloading = false;
        hiddenKeys.push(tile.key);
        continue;
      }
      // 当瓦片被选中但未显示时（通常是父瓦片在等待子瓦片加载），需要保留它作为 fallback
      // 例如：level 12 的父瓦片被选中，但 level 14 的子瓦片正在加载中，
      // 此时父瓦片应该保留，以便在子瓦片加载完成前提供显示
      else if (tile.selectedThisFrame) {
        tile.eligibleForUnloading = false;
      }
      else {
        tile.eligibleForUnloading
          = !tile.touchedThisFrame && !hasBlockers(tile.blockers);
      }

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
