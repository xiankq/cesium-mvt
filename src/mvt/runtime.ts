import { CesiumMvtImageryProvider } from './imagery-provider'
import { TileScheduler } from './tile-scheduler'
import type { CesiumMvtRuntimeOptions, MvtSchedulerSnapshot } from './types'

type RuntimeListener = (snapshot: MvtSchedulerSnapshot) => void

export type CesiumMvtRuntime = {
  provider: CesiumMvtImageryProvider
  scheduler: TileScheduler
  subscribe: (listener: RuntimeListener) => () => void
  destroy: () => void
}

export function createCesiumMvtRuntime(options: CesiumMvtRuntimeOptions): CesiumMvtRuntime {
  const scheduler = new TileScheduler(
    options.source.id,
    options.maxConcurrentRequests,
    options.cacheSize,
  )

  const provider = new CesiumMvtImageryProvider({
    ...options.source,
    scheduler,
  })

  const subscribe = (listener: RuntimeListener) => scheduler.subscribe(listener)

  const destroy = () => {
    scheduler.destroy()
  }

  return {
    provider,
    scheduler,
    subscribe,
    destroy,
  }
}
