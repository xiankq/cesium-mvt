<script setup lang="ts">
import type { Viewer } from 'cesium';
import { watchEffect } from 'vue';
import { CesiumVectorTile } from './mvt/cesium-vector-tile';

const props = defineProps<{
  viewer: Viewer;
}>();

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

watchEffect(async (onCleanup) => {
  const vectorTile = await CesiumVectorTile.fromUrl(STYLE_URL);
  props.viewer.scene.primitives.add(vectorTile);
  onCleanup(() => {
    props.viewer.scene.primitives.remove(vectorTile);
  });
});
</script>

<template>
</template>
