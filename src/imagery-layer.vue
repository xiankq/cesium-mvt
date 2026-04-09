<script setup lang="ts">
import type { Viewer } from 'cesium';
import { watchEffect } from 'vue';
import { StyleImageryProvider } from './mvt/imagery-provider';

const props = defineProps<{
  viewer: Viewer;
}>();

watchEffect((onCleanup) => {
  const layer = props.viewer.imageryLayers.addImageryProvider(
    new StyleImageryProvider({
      scene: props.viewer.scene,
      style: 'https://tiles.openfreemap.org/styles/liberty',
    }),
  );
  onCleanup(() => layer && props.viewer.imageryLayers.remove(layer));
});
</script>

<template>
</template>
