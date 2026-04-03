import type { ImageryLayer, Request, Viewer } from 'cesium'
import { UrlTemplateImageryProvider } from 'cesium'
import { CesiumMvtPrimitiveLayer } from './render/layer'
import { TileImageCache } from './request/image'
import { createTileDecodeJob } from './request/job'
import { CesiumMvtSourceCache } from './scheduler/source'
import { TileScheduler } from './scheduler/scheduler'
import { resolveMapLibreStyleBackgroundColor } from './style/renderer'
import type { MapLibreStyleDocument } from './style/document'
import type {
  MvtProviderOptions,
  MvtSchedulerSnapshot,
  MvtSourceOptions,
  TileDecodeJob,
} from './types'

type SchedulerListener = (snapshot: MvtSchedulerSnapshot) => void

export type MvtImageryProviderOptions = MvtProviderOptions & {
  viewer: Viewer
  style?: MapLibreStyleDocument
}

export class MvtImageryProvider extends UrlTemplateImageryProvider {
  readonly scheduler: TileScheduler

  private readonly viewer: Viewer
  private readonly sourceCache: CesiumMvtSourceCache
  private readonly imageryLayer: ImageryLayer
  private readonly tileRequestSource: MvtSourceOptions
  private readonly tileImageCache = new TileImageCache()
  private readonly backgroundTileFillStyle?: string
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
    const {
      id,
      urlTemplate,
      subdomains,
      customTags,
      ...imageryOptions
    } = source
    const backgroundColor = style
      ? resolveMapLibreStyleBackgroundColor(style)
      : undefined

    super({
      ...imageryOptions,
      url: urlTemplate,
      enablePickFeatures: false,
      hasAlphaChannel: true,
    })

    this.viewer = viewer
    this.tileRequestSource = {
      id,
      urlTemplate,
      subdomains,
      maximumLevel: this.maximumLevel,
      tilingScheme: this.tilingScheme,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      customTags,
    }
    this.backgroundTileFillStyle = backgroundColor?.toCssColorString()
    this.scheduler = new TileScheduler(
      source.id,
      maxConcurrentRequests,
      cacheSize,
    )
    this.imageryLayer = viewer.scene.imageryLayers.addImageryProvider(this)

    this.sourceCache = new CesiumMvtSourceCache({
      scene: viewer.scene,
      scheduler: this.scheduler,
      tilingScheme: this.tilingScheme,
      source,
      imageryLayer: this.imageryLayer,
    })

    try {
      if (style) {
        this.previewLayer = new CesiumMvtPrimitiveLayer(
          viewer.scene,
          this.scheduler,
          this.tilingScheme,
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

  override requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<HTMLCanvasElement> {
    const coord = { x, y, level }
    this.sourceCache.touch(coord)

    const job: TileDecodeJob = createTileDecodeJob(
      this.tileRequestSource,
      this.tilingScheme,
      coord,
    )

    this.scheduler.schedule(job)

    return Promise.resolve(
      this.tileImageCache.get(
        this.tileWidth,
        this.tileHeight,
        this.backgroundTileFillStyle,
      ),
    )
  }

  override pickFeatures(
    _x: number,
    _y: number,
    _level: number,
    _longitude: number,
    _latitude: number,
  ): undefined {
    return undefined
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.previewLayer?.destroy()
    this.previewLayer = undefined
    this.tileImageCache.clear()
    this.sourceCache.destroy()
    this.viewer.scene.imageryLayers.remove(this.imageryLayer, true)
    this.scheduler.destroy()
  }
}
