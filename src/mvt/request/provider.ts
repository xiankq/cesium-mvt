import type { Request } from 'cesium'
import { UrlTemplateImageryProvider } from 'cesium'
import { createTransparentCanvas } from './transparent-canvas'
import { createTileDecodeJob } from './job'
import type { CesiumMvtSourceCache } from '../scheduler/source'
import type { TileScheduler } from '../scheduler/scheduler'
import type { MvtSourceOptions, TileDecodeJob } from '../types'

export type TileRequestImageryProviderOptions = MvtSourceOptions & {
  scheduler: TileScheduler
}

export class TileRequestImageryProvider extends UrlTemplateImageryProvider {
  private readonly scheduler: TileScheduler
  private readonly sourceId: string
  private readonly urlTemplate: string
  private readonly subdomains?: string | string[]
  private readonly customTags?: MvtSourceOptions['customTags']
  private lifecycle?: CesiumMvtSourceCache

  constructor(options: TileRequestImageryProviderOptions) {
    const {
      scheduler,
      id,
      urlTemplate,
      subdomains,
      customTags,
      ...imageryOptions
    } = options

    super({
      ...imageryOptions,
      url: urlTemplate,
      enablePickFeatures: false,
      hasAlphaChannel: true,
    })

    this.scheduler = scheduler
    this.sourceId = id
    this.urlTemplate = urlTemplate
    this.subdomains = subdomains
    this.customTags = customTags
  }

  setLifecycle(lifecycle: CesiumMvtSourceCache | undefined): void {
    this.lifecycle = lifecycle
  }

  override requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<HTMLCanvasElement> {
    const coord = { x, y, level }
    this.lifecycle?.touch(coord)

    const job: TileDecodeJob = createTileDecodeJob(
      {
        id: this.sourceId,
        urlTemplate: this.urlTemplate,
        subdomains: this.subdomains,
        maximumLevel: this.maximumLevel,
        tilingScheme: this.tilingScheme,
        tileWidth: this.tileWidth,
        tileHeight: this.tileHeight,
        customTags: this.customTags,
      },
      this.tilingScheme,
      coord,
    )

    this.scheduler.schedule(job)

    return Promise.resolve(createTransparentCanvas(this.tileWidth, this.tileHeight))
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
}
