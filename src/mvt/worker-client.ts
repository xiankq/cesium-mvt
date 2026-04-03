import type { DecodedTileRecord, TileDecodeJob } from './types'

type WorkerRequest = {
  id: number
  kind: 'decode'
  job: TileDecodeJob
}

type WorkerSuccessResponse = {
  id: number
  ok: true
  tile: DecodedTileRecord
}

type WorkerErrorResponse = {
  id: number
  ok: false
  error: string
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

type PendingJob = {
  resolve: (tile: DecodedTileRecord) => void
  reject: (error: Error) => void
}

export class VectorTileWorkerClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingJob>()
  private requestId = 0

  constructor() {
    this.worker = new Worker(new URL('./worker/vector-tile.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = this.handleMessage
    this.worker.onerror = this.handleError
  }

  decode(job: TileDecodeJob): Promise<DecodedTileRecord> {
    const id = this.requestId + 1
    this.requestId = id

    return new Promise<DecodedTileRecord>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })

      const message: WorkerRequest = {
        id,
        kind: 'decode',
        job,
      }

      this.worker.postMessage(message)
    })
  }

  destroy(): void {
    this.worker.terminate()
    for (const { reject } of this.pending.values()) {
      reject(new Error('Vector tile worker was terminated.'))
    }
    this.pending.clear()
  }

  private handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    const pending = this.pending.get(message.id)
    if (!pending) return

    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.tile)
      return
    }

    pending.reject(new Error(message.error))
  }

  private handleError = (event: ErrorEvent) => {
    const error = new Error(event.message)

    for (const { reject } of this.pending.values()) {
      reject(error)
    }
    this.pending.clear()
  }
}
