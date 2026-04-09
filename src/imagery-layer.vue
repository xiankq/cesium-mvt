<script setup lang="ts">
import type { Viewer } from 'cesium';
import { watchEffect } from 'vue';

const props = defineProps<{
  viewer: Viewer;
}>();

watchEffect((onCleanup) => {
  const layer = props.viewer.imageryLayers.addImageryProvider(
    new MvtImageryProvider({
      scene: props.viewer.scene,
      source: 'openmaptiles',
      style: 'https://tiles.openfreemap.org/styles/bright',
    }),
  );
  onCleanup(() => layer && props.viewer.imageryLayers.remove(layer));
});
</script>

<template>
</template>
