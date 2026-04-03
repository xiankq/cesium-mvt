<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Color,
  EllipsoidTerrainProvider,
  ImageryLayer,
  OpenStreetMapImageryProvider,
  Viewer,
} from 'cesium'

const container = ref<HTMLDivElement | null>(null)

let viewer: Viewer | undefined

function resetCamera() {
  viewer?.camera.flyHome(1.4)
}

onMounted(() => {
  if (!container.value) return

  viewer = new Viewer(container.value, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    shouldAnimate: false,
    baseLayer: new ImageryLayer(
      new OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      }),
    ),
    terrainProvider: new EllipsoidTerrainProvider(),
  })

  viewer.scene.globe.baseColor = Color.fromCssColorString('#08111f')
  viewer.scene.globe.enableLighting = false
  viewer.scene.globe.showGroundAtmosphere = true
  const skyAtmosphere = viewer.scene.skyAtmosphere
  if (skyAtmosphere) {
    skyAtmosphere.hueShift = -0.6
    skyAtmosphere.saturationShift = -0.2
    skyAtmosphere.brightnessShift = -0.15
  }
  viewer.scene.highDynamicRange = false
  viewer.camera.flyHome(0)
})

onBeforeUnmount(() => {
  viewer?.destroy()
  viewer = undefined
})
</script>

<template>
  <main class="cesium-page">
    <div
      ref="container"
      class="cesium-surface"
      aria-label="Cesium globe viewer"
    ></div>

    <section class="hud">
      <p class="eyebrow">Vite + Vue 3 + TypeScript</p>
      <h1>Cesium 全屏地球</h1>
      <p class="description">
        这是一个使用 <code>unplugin-cesium</code> 接入的全屏 Cesium 页面。用鼠标拖拽、滚轮和右键即可浏览三维地球。
      </p>

      <div class="actions">
        <button type="button" class="hud-button" @click="resetCamera">
          回到初始视角
        </button>
      </div>
    </section>

    <div class="hud-chip">OpenStreetMap + Ellipsoid terrain</div>
  </main>
</template>
