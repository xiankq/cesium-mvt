import { TileCache } from './tile-cache'
import type {
  DecodedTileRecord,
  MvtSchedulerSnapshot,
  TileDecodeEvent,
  TileDecodeJob,
} from './types'
import { VectorTileWorkerClient } from './worker-client'

type SchedulerListener = (snapshot: MvtSchedulerSnapshot) => void
type TileListener = (event: TileDecodeEvent) => void

export class TileScheduler {
  private readonly worker = new VectorTileWorkerClient()
  private readonly cache: TileCache<string, DecodedTileRecord>
  private readonly queue: TileDecodeJob[] = []
  private readonly queuedIds = new Set<string>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly listeners = new Set<SchedulerListener>()
  private readonly tileListeners = new Set<TileListener>()
  private readonly state: MvtSchedulerSnapshot
  private readonly maxConcurrentRequests: number

  constructor(
    sourceId: string,
    maxConcurrentRequests = 4,
    cacheSize = 64,
  ) {
    this.maxConcurrentRequests = maxConcurrentRequests
    this.cache = new TileCache<string, DecodedTileRecord>(cacheSize)
    this.state = {
      sourceId,
      queued: 0,
      inFlight: 0,
      cached: 0,
      requested: 0,
      decoded: 0,
      failed: 0,
      maxConcurrent: maxConcurrentRequests,
    }
  }

  getSnapshot(): MvtSchedulerSnapshot {
    return {
      ...this.state,
      queued: this.queue.length,
      inFlight: this.inflight.size,
      cached: this.cache.size,
    }
  }

  getTile(tileId: string): DecodedTileRecord | undefined {
    return this.cache.get(tileId)
  }

  getCachedTiles(): DecodedTileRecord[] {
    return Array.from(this.cache.values())
  }

  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())

    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeTiles(listener: TileListener): () => void {
    this.tileListeners.add(listener)

    return () => {
      this.tileListeners.delete(listener)
    }
  }

  schedule(job: TileDecodeJob): void {
    if (this.cache.has(job.id) || this.inflight.has(job.id) || this.queuedIds.has(job.id)) {
      return
    }

    this.queue.push(job)
    this.queuedIds.add(job.id)
    this.state.requested += 1
    this.state.lastTileId = job.id
    this.emit()
    void this.pump()
  }

  cancel(tileId: string): boolean {
    const queueIndex = this.queue.findIndex((job) => job.id === tileId)
    if (queueIndex === -1) {
      return false
    }

    this.queue.splice(queueIndex, 1)
    this.queuedIds.delete(tileId)
    this.state.lastTileId = tileId
    this.emit()
    return true
  }

  destroy(): void {
    this.queue.length = 0
    this.queuedIds.clear()
    this.inflight.clear()
    this.cache.clear()
    this.listeners.clear()
    this.tileListeners.clear()
    this.worker.destroy()
  }

  private async pump(): Promise<void> {
    while (this.inflight.size < this.maxConcurrentRequests && this.queue.length > 0) {
      const job = this.queue.shift()
      if (!job) break

      this.queuedIds.delete(job.id)

      const task = this.runJob(job)
      this.inflight.set(job.id, task)
      this.emit()
      void task
    }
  }

  private async runJob(job: TileDecodeJob): Promise<void> {
    try {
      const tile = await this.worker.decode(job)
      const evicted = this.cache.set(job.id, tile)
      this.state.decoded += 1
      this.state.lastTileId = job.id
      this.emitTile({
        type: 'decoded',
        tile,
      })
      for (const entry of evicted) {
        this.emitTile({
          type: 'evicted',
          tileId: entry.key,
        })
      }
    } catch (error) {
      this.state.failed += 1
      this.state.lastError = error instanceof Error ? error.message : String(error)
    } finally {
      this.inflight.delete(job.id)
      this.emit()
      void this.pump()
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private emitTile(event: TileDecodeEvent): void {
    for (const listener of this.tileListeners) {
      listener(event)
    }
  }
}
