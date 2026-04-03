<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, shallowRef } from 'vue'
import { Viewer } from 'cesium'
import { ViewerKey } from './viewer-context'

const container = shallowRef<HTMLDivElement | null>(null)
const viewerRef = shallowRef<Viewer>()

provide(ViewerKey, viewerRef)

onMounted(() => {
  if (!container.value) return

  const viewer = new Viewer(container.value, {
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
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    shouldAnimate: false,
  })

  viewerRef.value = viewer
})

onBeforeUnmount(() => {
  viewerRef.value?.destroy()
  viewerRef.value = undefined
})
</script>

<template>
  <div class="cesium-viewer-shell">
    <div
      ref="container"
      class="cesium-surface"
      aria-label="Cesium globe viewer"
    ></div>
    <slot />
  </div>
</template>
