<template>
  <main class="cesium-page">
    <Viewer>
      <MvtScene />
    </Viewer>
  </main>
</template>

<script setup lang="ts">
import Viewer from './components/Viewer.vue'
import MvtScene from './components/MvtScene.vue'
</script>
