<script setup lang="ts">
import type { Viewer } from 'cesium';
import { watchEffect } from 'vue';
import { StyleImageryProvider } from './mvt/imagery-provider';

const props = defineProps<{
  viewer: Viewer;
}>();

watchEffect((onCleanup) => {
  const provider = new StyleImageryProvider({
    scene: props.viewer.scene,
    style: 'https://tiles.openfreemap.org/styles/liberty',
  });
  const layer = props.viewer.imageryLayers.addImageryProvider(provider);
  onCleanup(() => {
    props.viewer.imageryLayers.remove(layer);
    provider.destroy();
  });
});
</script>

<template>
</template>
