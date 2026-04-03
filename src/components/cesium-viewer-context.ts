import type { ShallowRef } from 'vue'
import type { Viewer } from 'cesium'
import type { InjectionKey } from 'vue'

export type CesiumViewerContext = ShallowRef<Viewer | undefined>

export const CesiumViewerKey: InjectionKey<CesiumViewerContext> = Symbol(
  'CesiumViewer',
)
