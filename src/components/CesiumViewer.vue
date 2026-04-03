<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, shallowRef } from 'vue'
import { EllipsoidTerrainProvider, Viewer } from 'cesium'
import { CesiumViewerKey } from './cesium-viewer-context'

const emit = defineEmits<{
  ready: [viewer: Viewer]
}>()

const container = shallowRef<HTMLDivElement | null>(null)
const viewerRef = shallowRef<Viewer>()

provide(CesiumViewerKey, viewerRef)

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
    terrainProvider: new EllipsoidTerrainProvider(),
  })

  viewerRef.value = viewer
  emit('ready', viewer)
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
