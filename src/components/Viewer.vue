<script setup lang="ts">
import { Viewer } from 'cesium';
import { onBeforeUnmount, onMounted, provide, shallowRef } from 'vue';
import { ViewerKey } from './viewer-context';

const container = shallowRef<HTMLDivElement | null>(null);
const viewerRef = shallowRef<Viewer>();
let renderErrorCleanup: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let createRetryHandle: ReturnType<typeof setTimeout> | undefined;
let viewerCreating = false;

const VIEWER_CREATE_RETRY_DELAY_MS = 1000;

provide(ViewerKey, viewerRef);

function hasUsableSize(element: HTMLDivElement | null | undefined): element is HTMLDivElement {
  return Boolean(element && element.clientWidth > 0 && element.clientHeight > 0);
}

function clearCreateRetryTimer() {
  if (createRetryHandle !== undefined) {
    clearTimeout(createRetryHandle);
    createRetryHandle = undefined;
  }
}

function syncViewerRenderLoop() {
  const viewer = viewerRef.value;
  const target = container.value;
  if (!viewer || !target) {
    return;
  }

  const shouldRender = hasUsableSize(target);
  if (viewer.useDefaultRenderLoop !== shouldRender) {
    viewer.useDefaultRenderLoop = shouldRender;
  }

  if (!shouldRender) {
    return;
  }

  viewer.resize();
  const canvas = viewer.scene.canvas;
  if (canvas.width <= 0 || canvas.height <= 0) {
    return;
  }

  viewer.scene.requestRender();
}

function destroyViewer() {
  renderErrorCleanup?.();
  renderErrorCleanup = undefined;
  viewerRef.value?.destroy();
  viewerRef.value = undefined;
}

function createViewer(target: HTMLDivElement) {
  target.replaceChildren();

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
    useDefaultRenderLoop: true,
  });

  const handleRenderError = (_scene: unknown, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Expected width to be greater than 0')) {
      return;
    }

    console.error('Cesium render error.', error);
  };

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    console.error('Cesium WebGL context lost. Recreating viewer.');
    destroyViewer();
    clearCreateRetryTimer();
    createRetryHandle = setTimeout(() => {
      createRetryHandle = undefined;
      ensureViewer();
    }, VIEWER_CREATE_RETRY_DELAY_MS);
  };

  viewer.scene.renderError.addEventListener(handleRenderError);
  viewer.scene.canvas.addEventListener('webglcontextlost', handleContextLost);
  renderErrorCleanup = () => {
    viewer.scene.renderError.removeEventListener(handleRenderError);
    viewer.scene.canvas.removeEventListener('webglcontextlost', handleContextLost);
  };

  viewerRef.value = viewer;
}

function ensureViewer() {
  const target = container.value;
  if (!target || !hasUsableSize(target) || viewerRef.value || viewerCreating) {
    return;
  }

  viewerCreating = true;

  try {
    createViewer(target);
  }
  catch (error) {
    target.replaceChildren();
    console.error('Failed to create Cesium viewer.', error);

    clearCreateRetryTimer();
    createRetryHandle = setTimeout(() => {
      createRetryHandle = undefined;
      ensureViewer();
    }, VIEWER_CREATE_RETRY_DELAY_MS);
  }
  finally {
    viewerCreating = false;
  }
}

onMounted(() => {
  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      ensureViewer();
      syncViewerRenderLoop();
    });
    resizeObserver.observe(container.value);
  }

  ensureViewer();
  syncViewerRenderLoop();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  clearCreateRetryTimer();
  destroyViewer();
});
</script>

<template>
  <div class="cesium-viewer-shell">
    <div
      ref="container"
      class="cesium-surface"
      aria-label="Cesium globe viewer"
    />
    <slot />
  </div>
</template>
