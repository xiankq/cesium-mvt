<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, shallowRef } from 'vue'
import { Viewer } from 'cesium'
import { ViewerKey } from './viewer-context'

const container = shallowRef<HTMLDivElement | null>(null)
const viewerRef = shallowRef<Viewer>()
let animationFrameHandle: number | undefined
let renderErrorCleanup: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let createRetryHandle: ReturnType<typeof setTimeout> | undefined
let viewerCreating = false

const VIEWER_CREATE_RETRY_DELAY_MS = 1000

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

function clearCreateRetryTimer() {
  if (createRetryHandle !== undefined) {
    clearTimeout(createRetryHandle)
    createRetryHandle = undefined
  }
}

function destroyViewer() {
  renderErrorCleanup?.()
  renderErrorCleanup = undefined
  viewerRef.value?.destroy()
  viewerRef.value = undefined
}

function createViewer(target: HTMLDivElement) {
  target.replaceChildren()

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
  if (!target || !hasUsableSize(target) || viewerRef.value || viewerCreating) {
    return
  }

  viewerCreating = true

  try {
    createViewer(target)
  } catch (error) {
    target.replaceChildren()
    console.error('Failed to create Cesium viewer.', error)

    clearCreateRetryTimer()
    createRetryHandle = setTimeout(() => {
      createRetryHandle = undefined
      ensureViewer()
    }, VIEWER_CREATE_RETRY_DELAY_MS)
  } finally {
    viewerCreating = false
  }
}

function tick() {
  renderViewerFrame()
  animationFrameHandle = requestAnimationFrame(tick)
}

onMounted(() => {
  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      ensureViewer()
      if (!viewerRef.value || !hasUsableSize(container.value)) {
        return
      }

      viewerRef.value.resize()
      viewerRef.value.scene.requestRender()
    })
    resizeObserver.observe(container.value)
  }

  ensureViewer()
  animationFrameHandle = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (animationFrameHandle !== undefined) {
    cancelAnimationFrame(animationFrameHandle)
    animationFrameHandle = undefined
  }
  resizeObserver?.disconnect()
  resizeObserver = undefined
  clearCreateRetryTimer()
  destroyViewer()
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
