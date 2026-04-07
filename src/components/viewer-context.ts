import type { Viewer } from 'cesium';
import type { InjectionKey, ShallowRef } from 'vue';

export type ViewerContext = ShallowRef<Viewer | undefined>;

export const ViewerKey: InjectionKey<ViewerContext> = Symbol(
  'Viewer',
);
