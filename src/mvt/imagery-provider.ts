import { UrlTemplateImageryProvider } from 'cesium'
import type { MvtSourceOptions, TileDecodeJob } from './types'
import { createTransparentCanvas } from './transparent-canvas'
import type { TileScheduler } from './tile-scheduler'
import type { Request } from 'cesium'
import { createTileDecodeJob } from './tile-job'

export type CesiumMvtImageryProviderOptions = MvtSourceOptions & {
  scheduler: TileScheduler
}

export class CesiumMvtImageryProvider extends UrlTemplateImageryProvider {
  private readonly scheduler: TileScheduler
  private readonly sourceId: string
  private readonly urlTemplate: string
  private readonly subdomains?: string | string[]
  private readonly customTags?: MvtSourceOptions['customTags']

  constructor(options: CesiumMvtImageryProviderOptions) {
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

  override requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<HTMLCanvasElement> {
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
      { x, y, level },
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
