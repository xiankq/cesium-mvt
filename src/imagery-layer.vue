<script setup lang="ts">
import type { Viewer } from 'cesium';
import { Color } from 'cesium';
import { watchEffect } from 'vue';
import { CesiumVectorTile } from './mvt/cesium-vector-tile';

const props = defineProps<{
  viewer: Viewer;
}>();

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

watchEffect(async (onCleanup) => {
  // eslint-disable-next-line vue/no-mutating-props
  props.viewer.scene.globe.baseColor = Color.fromCssColorString('#f8f4f0');
  const vectorTile = await CesiumVectorTile.fromUrl(STYLE_URL);
  props.viewer.scene.primitives.add(vectorTile);
  onCleanup(() => {
    props.viewer.scene.primitives.remove(vectorTile);
  });
});
</script>

<template>
</template>
