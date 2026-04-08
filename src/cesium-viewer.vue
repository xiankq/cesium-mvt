<script setup lang="ts">
import { Camera, Rectangle, Viewer } from 'cesium';
import { shallowRef, useTemplateRef, watchPostEffect } from 'vue';
import ImageryLayer from './imagery-layer.vue';

const containerRef = useTemplateRef('containerRef');
const viewer = shallowRef<Viewer>();
// 默认相机视角，此位置提供给camera.flyHome调用
Camera.DEFAULT_VIEW_RECTANGLE = new Rectangle(
  1.8678385340361645,
  0.312485648539553,
  1.9623184684984898,
  0.3555841642945612,
);
Camera.DEFAULT_VIEW_FACTOR = 0; // 默认相机位置放大系数

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
