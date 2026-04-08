<script setup lang="ts">
import type { Viewer } from 'cesium';
import { watchEffect } from 'vue';
import { MvtImageryProvider } from './mvt';

const props = defineProps<{
  viewer: Viewer;
}>();

watchEffect((onCleanup) => {
  const layer = props.viewer.imageryLayers.addImageryProvider(
    new MvtImageryProvider({
      scene: props.viewer.scene,
      source: 'openmaptiles',
      styleUrl: 'https://tiles.openfreemap.org/styles/bright',
    }),
  );
  onCleanup(() => layer && props.viewer.imageryLayers.remove(layer));
});
</script>

<template>
</template>
