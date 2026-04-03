<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, shallowRef } from 'vue'
import { Viewer } from 'cesium'
import { ViewerKey } from './viewer-context'

const container = shallowRef<HTMLDivElement | null>(null)
const viewerRef = shallowRef<Viewer>()
let animationFrameHandle: number | undefined
let renderErrorCleanup: (() => void) | undefined

provide(ViewerKey, viewerRef)

function hasUsableSize(element: HTMLDivElement | null | undefined): element is HTMLDivElement {
  return Boolean(element && element.clientWidth > 0 && element.clientHeight > 0)
}

function renderViewerFrame() {
  const target = container.value
  if (!target || !hasUsableSize(target)) {
    return
  }

  const viewer = viewerRef.value
  if (!viewer) {
    return
  }

  viewer.resize()
  const canvas = viewer.scene.canvas
  if (canvas.width <= 0 || canvas.height <= 0) {
    return
  }

  viewer.render()
}

function createViewer(target: HTMLDivElement) {
  const viewer = new Viewer(target, {
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
    showRenderLoopErrors: false,
    timeline: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    shouldAnimate: false,
    useDefaultRenderLoop: false,
  })

  const handleRenderError = (_scene: unknown, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Expected width to be greater than 0')) {
      return
    }

    console.error('Cesium render error.', error)
  }

  viewer.scene.renderError.addEventListener(handleRenderError)
  renderErrorCleanup = () => {
    viewer.scene.renderError.removeEventListener(handleRenderError)
  }

  viewerRef.value = viewer
}

function ensureViewer() {
  const target = container.value
  if (!target || !hasUsableSize(target)) {
    return
  }

  if (!viewerRef.value) {
    createViewer(target)
  }
}

function tick() {
  ensureViewer()
  renderViewerFrame()
  animationFrameHandle = requestAnimationFrame(tick)
}

onMounted(() => {
  animationFrameHandle = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (animationFrameHandle !== undefined) {
    cancelAnimationFrame(animationFrameHandle)
    animationFrameHandle = undefined
  }
  renderErrorCleanup?.()
  renderErrorCleanup = undefined
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
