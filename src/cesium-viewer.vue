<script setup lang="ts">
import { Camera, Rectangle, Viewer } from 'cesium';
import { shallowRef, useTemplateRef, watchPostEffect } from 'vue';
import ImageryLayer from './imagery-layer.vue';

const containerRef = useTemplateRef('containerRef');
const viewer = shallowRef<Viewer>();

Camera.DEFAULT_VIEW_RECTANGLE = new Rectangle(
  2.119768731510039,
  0.5450066465113448,
  2.121083088948845,
  0.545555933360964,
);
Camera.DEFAULT_VIEW_FACTOR = 0;

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
      requestRenderMode: true,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
    });

    viewer.value.scene.debugShowFramesPerSecond = true;
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
