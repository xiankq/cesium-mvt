import type { ImageryLayer, Viewer } from 'cesium'
import { CesiumMvtPrimitiveLayer } from './render/feature-preview-layer'
import { TileRequestImageryProvider } from './request/tile-request-imagery-provider'
import { CesiumMvtSourceCache } from './scheduler/source-cache'
import { TileScheduler } from './scheduler/tile-scheduler'
import { resolveMapLibreStyleBackgroundColor } from './style/maplibre-style-renderer'
import type { MapLibreStyleDocument } from './style/maplibre-style'
import type { MvtProviderOptions, MvtSchedulerSnapshot } from './types'

type SchedulerListener = (snapshot: MvtSchedulerSnapshot) => void

export type MvtImageryProviderOptions = MvtProviderOptions & {
  viewer: Viewer
  style?: MapLibreStyleDocument
}

export class MvtImageryProvider {
  readonly scheduler: TileScheduler
  readonly provider: TileRequestImageryProvider

  private readonly viewer: Viewer
  private readonly sourceCache: CesiumMvtSourceCache
  private readonly imageryLayer: ImageryLayer
  private previewLayer?: CesiumMvtPrimitiveLayer
  private destroyed = false

  constructor(options: MvtImageryProviderOptions) {
    const {
      viewer,
      source,
      style,
      maxConcurrentRequests,
      cacheSize,
    } = options

    this.viewer = viewer
    this.scheduler = new TileScheduler(
      source.id,
      maxConcurrentRequests,
      cacheSize,
    )
    this.provider = new TileRequestImageryProvider({
      ...source,
      scheduler: this.scheduler,
    })

    const backgroundColor = style
      ? resolveMapLibreStyleBackgroundColor(style)
      : undefined
    if (backgroundColor) {
      viewer.scene.globe.baseColor = backgroundColor
      viewer.scene.backgroundColor = backgroundColor
    }

    this.sourceCache = new CesiumMvtSourceCache({
      scene: viewer.scene,
      scheduler: this.scheduler,
      tilingScheme: this.provider.tilingScheme,
      source,
    })
    this.provider.setLifecycle(this.sourceCache)
    this.imageryLayer = viewer.scene.imageryLayers.addImageryProvider(this.provider)

    try {
      if (style) {
        this.previewLayer = new CesiumMvtPrimitiveLayer(
          viewer.scene,
          this.scheduler,
          this.provider.tilingScheme,
          {
            style,
            sourceCache: this.sourceCache,
          },
        )
      }
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  subscribe(listener: SchedulerListener): () => void {
    return this.scheduler.subscribe(listener)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.previewLayer?.destroy()
    this.previewLayer = undefined
    this.provider.setLifecycle(undefined)
    this.sourceCache.destroy()
    this.viewer.scene.imageryLayers.remove(this.imageryLayer, true)
    this.scheduler.destroy()
  }
}
