<script setup lang="ts">
import MvtScene from './components/MvtScene.vue';
import Viewer from './components/Viewer.vue';
</script>

<template>
  <main class="cesium-page">
    <Viewer>
      <MvtScene />
    </Viewer>
  </main>
</template>
