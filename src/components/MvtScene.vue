<script setup lang="ts">
import type { Viewer } from 'cesium';
import { inject, onBeforeUnmount, watch } from 'vue';
import { resolveOpenFreeMapMvtRuntimeConfigFromEnv } from '../integrations/openfreemap';
import { MvtImageryProvider } from '../mvt';
import { ViewerKey } from './viewer-context';

let viewer: Viewer | undefined;
let mvtProvider: MvtImageryProvider | undefined;
let loadAbortController: AbortController | undefined;
let destroyed = false;
const viewerRef = inject(ViewerKey);

if (!viewerRef) {
  throw new Error('MvtScene must be used inside Viewer.');
}

function configureViewer(currentViewer: Viewer) {
  currentViewer.scene.globe.enableLighting = false;
  currentViewer.scene.globe.showGroundAtmosphere = true;
  currentViewer.scene.highDynamicRange = false;
  currentViewer.camera.flyHome(0);
}

watch(
  () => viewerRef.value,
  (readyViewer) => {
    if (!readyViewer || destroyed) {
      return;
    }

    if (viewer && viewer !== readyViewer) {
      detachMvtProvider();
    }

    viewer = readyViewer;
    configureViewer(readyViewer);
    void loadMvtProvider();
  },
  { immediate: true },
);

function detachMvtProvider() {
  mvtProvider?.destroy();
  mvtProvider = undefined;
}

async function loadMvtProvider() {
  if (!viewer)
    return;

  detachMvtProvider();

  loadAbortController?.abort();
  loadAbortController = new AbortController();

  try {
    const config = await resolveOpenFreeMapMvtRuntimeConfigFromEnv(
      loadAbortController.signal,
    );
    if (destroyed || loadAbortController.signal.aborted || !viewer || !config.enabled) {
      return;
    }

    mvtProvider = new MvtImageryProvider({
      viewer,
      source: config.source,
      style: config.style,
      maxConcurrentRequests: config.maxConcurrentRequests,
      cacheSize: config.cacheSize,
    });
  }
  catch (error) {
    if (destroyed || loadAbortController?.signal.aborted)
      return;

    console.error('Failed to initialize MVT imagery provider.', error);
  }
}

onBeforeUnmount(() => {
  destroyed = true;

  loadAbortController?.abort();
  loadAbortController = undefined;

  detachMvtProvider();

  viewer = undefined;
});
</script>

<template></template>
