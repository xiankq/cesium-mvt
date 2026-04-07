import { TileCache } from './cache'
import type {
  DecodedTileRecord,
  MvtSchedulerSnapshot,
  TileDecodeEvent,
  TileDecodeJob,
} from '../types'
import { VectorTileWorkerClient } from '../worker/client'
import { isTileDecodeAbortError } from '../worker/protocol'
import TinyQueue from 'tinyqueue'

type SchedulerListener = (snapshot: MvtSchedulerSnapshot) => void
type TileListener = (event: TileDecodeEvent) => void

type QueuedTileJob = {
  job: TileDecodeJob
  token: number
  priority: number
  sequence: number
}

type PendingTileJob = {
  job: TileDecodeJob
  token: number
}

type InflightTileJob = {
  promise: Promise<void>
  cancel: () => boolean
}

type TileFailureState = {
  count: number
  retryAt: number
}

const DEFAULT_FAILURE_RETRY_BASE_MS = 300
const DEFAULT_FAILURE_RETRY_MAX_MS = 4_000

function compareQueuedTileJobs(left: QueuedTileJob, right: QueuedTileJob): number {
  const priorityDelta = right.priority - left.priority
  if (priorityDelta !== 0) {
    return priorityDelta
  }

  return right.sequence - left.sequence
}

function resolveDefaultMaxConcurrentRequests(): number {
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency === undefined) {
    return 4
  }

  return Math.max(2, Math.min(8, Math.floor(hardwareConcurrency)))
}

function resolveDefaultCacheSize(maxConcurrentRequests: number): number {
  const navigatorWithDeviceMemory = globalThis.navigator as
    | (Navigator & {
        deviceMemory?: number
      })
    | undefined
  const deviceMemory = navigatorWithDeviceMemory?.deviceMemory
  const memoryDrivenSize =
    Number.isFinite(deviceMemory) && deviceMemory !== undefined
      ? Math.floor(Math.max(128, deviceMemory * 48))
      : 192
  return Math.max(memoryDrivenSize, maxConcurrentRequests * 32)
}

export class TileScheduler {
  private readonly worker: VectorTileWorkerClient
  private readonly cache: TileCache<string, DecodedTileRecord>
  private readonly queue = new TinyQueue<QueuedTileJob>([], compareQueuedTileJobs)
  private readonly queuedIds = new Set<string>()
  private readonly pendingJobs = new Map<string, PendingTileJob>()
  private readonly requestTokens = new Map<string, number>()
  private readonly inflight = new Map<string, InflightTileJob>()
  private readonly pinned = new Map<string, number>()
  private readonly listeners = new Set<SchedulerListener>()
  private readonly tileListeners = new Set<TileListener>()
  private readonly retryState = new Map<string, TileFailureState>()
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly state: MvtSchedulerSnapshot
  private readonly maxConcurrentRequests: number
  private sequence = 0

  constructor(
    sourceId: string,
    maxConcurrentRequests?: number,
    cacheSize?: number,
  ) {
    const resolvedMaxConcurrentRequests = Math.max(
      1,
      Math.floor(maxConcurrentRequests ?? resolveDefaultMaxConcurrentRequests()),
    )
    const resolvedCacheSize = Math.max(
      1,
      Math.floor(cacheSize ?? resolveDefaultCacheSize(resolvedMaxConcurrentRequests)),
    )

    this.maxConcurrentRequests = resolvedMaxConcurrentRequests
    this.worker = new VectorTileWorkerClient(resolvedMaxConcurrentRequests)
    this.cache = new TileCache<string, DecodedTileRecord>(resolvedCacheSize)
    this.state = {
      sourceId,
      queued: 0,
      inFlight: 0,
      cached: 0,
      requested: 0,
      decoded: 0,
      failed: 0,
      maxConcurrent: resolvedMaxConcurrentRequests,
    }
  }

  getSnapshot(): MvtSchedulerSnapshot {
    return {
      ...this.state,
      queued: this.queuedIds.size + this.pendingJobs.size,
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
    if (this.cache.has(job.id)) {
      this.touch(job.id)
      return
    }

    const token = this.bumpToken(job.id)
    if (this.inflight.has(job.id)) {
      this.pendingJobs.set(job.id, {
        job,
        token,
      })
    } else if (this.isRetryBlocked(job.id)) {
      this.pendingJobs.set(job.id, {
        job,
        token,
      })
      this.armRetry(job.id)
    } else {
      this.enqueue(job, token)
    }

    this.state.requested += 1
    this.state.lastTileId = job.id
    this.emit()
    void this.pump()
  }

  cancel(tileId: string): boolean {
    const hadQueued = this.queuedIds.delete(tileId)
    const hadInFlight = this.inflight.has(tileId)
    const hadPending = this.pendingJobs.delete(tileId) !== undefined
    const hadRetryTimer = this.clearRetryTimer(tileId)
    const hadKnownJob =
      hadQueued ||
      hadInFlight ||
      hadPending ||
      hadRetryTimer ||
      this.requestTokens.has(tileId)

    if (!hadKnownJob) {
      return false
    }

    this.inflight.get(tileId)?.cancel()
    this.bumpToken(tileId)
    this.state.lastTileId = tileId
    this.emit()
    return true
  }

  destroy(): void {
    while (this.queue.length > 0) {
      this.queue.pop()
    }
    this.queuedIds.clear()
    this.pendingJobs.clear()
    this.requestTokens.clear()
    for (const tileId of Array.from(this.retryTimers.keys())) {
      this.clearRetryTimer(tileId)
    }
    this.retryState.clear()
    for (const inflight of this.inflight.values()) {
      inflight.cancel()
    }
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
      if (!queued) {
        break
      }

      const { job, token } = queued
      if (!this.queuedIds.has(job.id)) {
        continue
      }

      const currentToken = this.requestTokens.get(job.id)
      if (currentToken !== token) {
        continue
      }

      if (this.isRetryBlocked(job.id)) {
        this.queuedIds.delete(job.id)
        this.pendingJobs.set(job.id, {
          job,
          token,
        })
        this.armRetry(job.id)
        continue
      }

      this.queuedIds.delete(job.id)

      const workerTask = this.worker.decode(job)
      const task = this.runJob(job, token, workerTask.promise)
      this.inflight.set(job.id, {
        promise: task,
        cancel: workerTask.cancel,
      })
      this.emit()
      void task
    }
  }

  private async runJob(
    job: TileDecodeJob,
    token: number,
    promise: Promise<DecodedTileRecord>,
  ): Promise<void> {
    try {
      const tile = await promise
      const currentToken = this.requestTokens.get(job.id)
      if (currentToken !== token) {
        return
      }

      this.clearFailureState(job.id)
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
      if (isTileDecodeAbortError(error)) {
        return
      }

      this.recordFailure(job.id)
      const message = formatTileDecodeFailure(job, error)
      this.state.failed += 1
      this.state.lastError = message
      console.error('[cesium-mvt] Tile decode failed.', {
        tileId: job.id,
        coord: job.coord,
        url: job.url,
        sourceId: job.sourceId,
        error: message,
      })
    } finally {
      this.inflight.delete(job.id)
      this.flushPendingJob(job.id)
      this.emit()
      void this.pump()
    }
  }

  private enqueue(job: TileDecodeJob, token: number): void {
    this.queue.push({
      job,
      token,
      priority: job.coord.level,
      sequence: this.sequence += 1,
    })
    this.queuedIds.add(job.id)
  }

  private bumpToken(tileId: string): number {
    const nextToken = (this.requestTokens.get(tileId) ?? 0) + 1
    this.requestTokens.set(tileId, nextToken)
    return nextToken
  }

  private flushPendingJob(tileId: string): void {
    const pending = this.pendingJobs.get(tileId)
    if (!pending) {
      return
    }

    this.pendingJobs.delete(tileId)

    const currentToken = this.requestTokens.get(tileId)
    if (currentToken !== pending.token || this.cache.has(tileId)) {
      return
    }

    if (this.isRetryBlocked(tileId)) {
      this.pendingJobs.set(tileId, pending)
      this.armRetry(tileId)
      return
    }

    this.enqueue(pending.job, pending.token)
  }

  private recordFailure(tileId: string): void {
    const previousCount = this.retryState.get(tileId)?.count ?? 0
    const nextCount = previousCount + 1
    const delay = Math.min(
      DEFAULT_FAILURE_RETRY_BASE_MS * 2 ** Math.max(0, nextCount - 1),
      DEFAULT_FAILURE_RETRY_MAX_MS,
    )

    this.retryState.set(tileId, {
      count: nextCount,
      retryAt: Date.now() + delay,
    })
    this.armRetry(tileId)
  }

  private clearFailureState(tileId: string): void {
    this.retryState.delete(tileId)
    this.clearRetryTimer(tileId)
  }

  private isRetryBlocked(tileId: string): boolean {
    const failureState = this.retryState.get(tileId)
    return failureState !== undefined && failureState.retryAt > Date.now()
  }

  private armRetry(tileId: string): void {
    if (this.retryTimers.has(tileId)) {
      return
    }

    const failureState = this.retryState.get(tileId)
    if (!failureState) {
      return
    }

    const delay = Math.max(0, failureState.retryAt - Date.now())
    const timer = setTimeout(() => {
      this.retryTimers.delete(tileId)

      const pending = this.pendingJobs.get(tileId)
      if (!pending) {
        return
      }

      const currentToken = this.requestTokens.get(tileId)
      if (
        currentToken !== pending.token ||
        this.cache.has(tileId) ||
        this.inflight.has(tileId)
      ) {
        return
      }

      if (this.isRetryBlocked(tileId)) {
        this.armRetry(tileId)
        return
      }

      this.pendingJobs.delete(tileId)
      this.enqueue(pending.job, pending.token)
      this.emit()
      void this.pump()
    }, delay)

    this.retryTimers.set(tileId, timer)
  }

  private clearRetryTimer(tileId: string): boolean {
    const timer = this.retryTimers.get(tileId)
    if (!timer) {
      return false
    }

    clearTimeout(timer)
    this.retryTimers.delete(tileId)
    return true
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

function formatTileDecodeFailure(job: TileDecodeJob, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `${job.id} (${job.coord.level}/${job.coord.x}/${job.coord.y}) ${detail}`
}
