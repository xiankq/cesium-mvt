import type { Scene } from 'cesium'
import type { CesiumMvtRuntime } from './runtime'
import { CesiumMvtPrimitiveLayer } from './feature-preview-layer'
import { CesiumMvtSourceCache } from './source-cache'
import type { MapLibreStyleDocument } from './maplibre-style'
import type { MvtSourceOptions } from './types'

export type CesiumMvtSceneAttachmentOptions = {
  scene: Scene
  runtime: CesiumMvtRuntime
  source: MvtSourceOptions
  style?: MapLibreStyleDocument
}

export type CesiumMvtSceneAttachment = {
  destroy: () => void
}

export function attachCesiumMvtScene(
  options: CesiumMvtSceneAttachmentOptions,
): CesiumMvtSceneAttachment {
  const { scene, runtime, source, style } = options

  const sourceCache = new CesiumMvtSourceCache({
    scene,
    scheduler: runtime.scheduler,
    tilingScheme: runtime.provider.tilingScheme,
    source,
  })
  runtime.provider.setLifecycle(sourceCache)

  const imageryLayer = scene.imageryLayers.addImageryProvider(runtime.provider)

  let previewLayer: CesiumMvtPrimitiveLayer | undefined
  try {
    previewLayer = new CesiumMvtPrimitiveLayer(
      scene,
      runtime.scheduler,
      runtime.provider.tilingScheme,
      {
        style,
        sourceCache,
      },
    )
  } catch (error) {
    runtime.provider.setLifecycle(undefined)
    scene.imageryLayers.remove(imageryLayer, true)
    sourceCache.destroy()
    throw error
  }

  return {
    destroy() {
      previewLayer?.destroy()
      runtime.provider.setLifecycle(undefined)
      sourceCache.destroy()
      scene.imageryLayers.remove(imageryLayer, true)
      previewLayer = undefined
    },
  }
}
