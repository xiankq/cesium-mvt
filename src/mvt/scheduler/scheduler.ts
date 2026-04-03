import { TileCache } from './cache'
import type {
  DecodedTileRecord,
  MvtSchedulerSnapshot,
  TileDecodeEvent,
  TileDecodeJob,
} from '../types'
import { VectorTileWorkerClient } from '../worker/client'
import TinyQueue from 'tinyqueue'

type SchedulerListener = (snapshot: MvtSchedulerSnapshot) => void
type TileListener = (event: TileDecodeEvent) => void

type QueuedTileJob = {
  job: TileDecodeJob
  token: number
  priority: number
  sequence: number
}

function compareQueuedTileJobs(left: QueuedTileJob, right: QueuedTileJob): number {
  const priorityDelta = right.priority - left.priority
  if (priorityDelta !== 0) {
    return priorityDelta
  }

  return left.sequence - right.sequence
}

export class TileScheduler {
  private readonly worker = new VectorTileWorkerClient()
  private readonly cache: TileCache<string, DecodedTileRecord>
  private readonly queue = new TinyQueue<QueuedTileJob>([], compareQueuedTileJobs)
  private readonly queuedIds = new Set<string>()
  private readonly requestTokens = new Map<string, number>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly pinned = new Map<string, number>()
  private readonly listeners = new Set<SchedulerListener>()
  private readonly tileListeners = new Set<TileListener>()
  private readonly state: MvtSchedulerSnapshot
  private readonly maxConcurrentRequests: number
  private sequence = 0

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
      queued: this.queuedIds.size,
      inFlight: this.inflight.size,
      cached: this.cache.size,
    }
  }

  getTile(tileId: string): DecodedTileRecord | undefined {
    return this.cache.get(tileId)
  }

  touch(tileId: string): boolean {
    return this.cache.get(tileId) !== undefined
  }

  pin(tileId: string): void {
    this.pinned.set(tileId, (this.pinned.get(tileId) ?? 0) + 1)
    this.touch(tileId)
  }

  unpin(tileId: string): void {
    const current = this.pinned.get(tileId)
    if (current === undefined) {
      return
    }

    if (current <= 1) {
      this.pinned.delete(tileId)
    } else {
      this.pinned.set(tileId, current - 1)
    }

    this.trimCache()
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

    const token = (this.requestTokens.get(job.id) ?? 0) + 1
    this.requestTokens.set(job.id, token)
    this.queue.push({
      job,
      token,
      priority: job.coord.level,
      sequence: this.sequence += 1,
    })
    this.queuedIds.add(job.id)
    this.state.requested += 1
    this.state.lastTileId = job.id
    this.emit()
    void this.pump()
  }

  cancel(tileId: string): boolean {
    if (!this.queuedIds.has(tileId)) {
      return false
    }

    this.queuedIds.delete(tileId)
    this.requestTokens.set(tileId, (this.requestTokens.get(tileId) ?? 0) + 1)
    this.state.lastTileId = tileId
    this.emit()
    return true
  }

  destroy(): void {
    while (this.queue.length > 0) {
      this.queue.pop()
    }
    this.queuedIds.clear()
    this.requestTokens.clear()
    this.inflight.clear()
    this.pinned.clear()
    this.cache.clear()
    this.listeners.clear()
    this.tileListeners.clear()
    this.worker.destroy()
  }

  private async pump(): Promise<void> {
    while (this.inflight.size < this.maxConcurrentRequests && this.queue.length > 0) {
      const queued = this.queue.pop()
      if (!queued) break

      const { job, token } = queued
      if (!this.queuedIds.has(job.id)) {
        continue
      }

      const currentToken = this.requestTokens.get(job.id)
      if (currentToken !== token) {
        continue
      }

      this.queuedIds.delete(job.id)

      const task = this.runJob(job, token)
      this.inflight.set(job.id, task)
      this.emit()
      void task
    }
  }

  private async runJob(job: TileDecodeJob, token: number): Promise<void> {
    try {
      const tile = await this.worker.decode(job)
      const currentToken = this.requestTokens.get(job.id)
      if (currentToken !== token) {
        return
      }

      const evicted = this.cache.set(job.id, tile, {
        skipEviction: (key) => this.pinned.has(key),
      })
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

  private trimCache(): void {
    const evicted = this.cache.trim((key) => this.pinned.has(key))
    for (const entry of evicted) {
      this.emitTile({
        type: 'evicted',
        tileId: entry.key,
      })
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
