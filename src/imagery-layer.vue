<script setup lang="ts">
import type { Viewer } from 'cesium';
import { watchEffect } from 'vue';
import { StyleImageryProvider } from './mvt/imagery-provider';

const props = defineProps<{
  viewer: Viewer;
}>();

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

watchEffect(async (onCleanup) => {
  const provider = await StyleImageryProvider.fromUrl(STYLE_URL, {
    scene: props.viewer.scene,
  });
  const layer = props.viewer.imageryLayers.addImageryProvider(provider);
  onCleanup(() => {
    layer && props.viewer.imageryLayers.remove(layer, true);
    provider?.destroy();
  });
});
</script>

<template>
</template>
