<script setup lang="ts">
import { Viewer } from 'cesium';
import { shallowRef, useTemplateRef, watchPostEffect } from 'vue';
import ImageryLayer from './imagery-layer.vue';

const containerRef = useTemplateRef('containerRef');
const viewer = shallowRef<Viewer>();

watchPostEffect((onCleanup) => {
  onCleanup(() => {
    viewer.value?.destroy();
    viewer.value = undefined;
  });
  if (containerRef.value) {
    viewer.value = new Viewer(containerRef.value, {
      animation: false,
      baseLayerPicker: false,
      baseLayer: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
    });
  }
});
</script>

<template>
  <div
    ref="containerRef"
    style="position: absolute; inset: 0;"
  />
  <ImageryLayer v-if="viewer" :viewer="viewer" />
</template>
