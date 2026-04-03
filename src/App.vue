<template>
  <main class="cesium-page">
    <CesiumViewer>
      <CesiumMvtScene />
    </CesiumViewer>
  </main>
</template>

<script setup lang="ts">
import CesiumViewer from './components/CesiumViewer.vue'
import CesiumMvtScene from './components/CesiumMvtScene.vue'
</script>
