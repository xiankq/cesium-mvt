import type { ShallowRef } from 'vue'
import type { Viewer } from 'cesium'
import type { InjectionKey } from 'vue'

export type ViewerContext = ShallowRef<Viewer | undefined>

export const ViewerKey: InjectionKey<ViewerContext> = Symbol(
  'Viewer',
)
