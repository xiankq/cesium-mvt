<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import {
  Color,
  Viewer,
} from 'cesium'
import {
  createCesiumMvtRuntime,
  attachCesiumMvtScene,
  resolveMapLibreStyleBackgroundColor,
  type CesiumMvtRuntime,
  type MvtSchedulerSnapshot,
} from '../mvt'
import {
  resolveOpenFreeMapMvtRuntimeConfigFromEnv,
  type OpenFreeMapMvtRuntimeConfig,
} from '../integrations/openfreemap'
import { CesiumViewerKey } from './cesium-viewer-context'

const mvtSnapshot = ref<MvtSchedulerSnapshot | null>(null)
const runtimeState = ref<
  | { status: 'idle' }
  | { status: 'loading'; message: string }
  | { status: 'ready'; config: OpenFreeMapMvtRuntimeConfig }
  | { status: 'disabled'; config: OpenFreeMapMvtRuntimeConfig }
  | { status: 'error'; message: string }
>({ status: 'idle' })

let viewer: Viewer | undefined
let mvtRuntime: CesiumMvtRuntime | undefined
let mvtSceneAttachment: { destroy: () => void } | undefined
let stopMvtSubscription: (() => void) | undefined
let loadAbortController: AbortController | undefined
let destroyed = false
let viewerConfigured = false
const viewerRef = inject(CesiumViewerKey)

if (!viewerRef) {
  throw new Error('CesiumMvtScene must be used inside CesiumViewer.')
}

const mvtStatus = computed(() => {
  switch (runtimeState.value.status) {
    case 'idle':
      return '待加载'
    case 'loading':
      return runtimeState.value.message
    case 'ready':
      return runtimeState.value.config.mode === 'style' ? 'Style 已加载' : '模板已加载'
    case 'disabled':
      return '未启用'
    case 'error':
      return '加载失败'
  }
})

const mvtSummary = computed(() => {
  const state = runtimeState.value

  if (state.status === 'idle') {
    return '正在准备 MVT 调度层。'
  }

  if (state.status === 'loading') {
    return state.message
  }

  if (state.status === 'error') {
    return state.message
  }

  if (state.status === 'disabled') {
    return state.config.summary
  }

  const snapshot = mvtSnapshot.value
  if (!snapshot) {
    return state.config.summary
  }

  return [
    `${snapshot.requested} requested`,
    `${snapshot.decoded} decoded`,
    `${snapshot.cached} cached`,
    `${snapshot.failed} failed`,
  ].join(' · ')
})

const mvtMeta = computed(() => {
  const state = runtimeState.value

  if (state.status === 'idle') {
    return '等待配置读取'
  }

  if (state.status === 'loading') {
    return state.message
  }

  if (state.status === 'error') {
    return '请检查 style URL、TileJSON 和网络访问'
  }

  const config = state.config
  const pieces = [
    `${config.mode} mode`,
    `source ${config.source.id}`,
    `concurrency ${config.maxConcurrentRequests ?? 4}`,
    `cache ${config.cacheSize ?? 64}`,
  ]

  if (config.sourceName) {
    pieces.push(`vector source ${config.sourceName}`)
  }
  if (config.styleUrl) {
    pieces.push(config.styleUrl)
  }
  if (config.sourceUrl) {
    pieces.push(config.sourceUrl)
  }

  return pieces.join(' · ')
})

const mvtChipLabel = computed(() => {
  const state = runtimeState.value

  if (state.status === 'ready') {
    return state.config.mode === 'style'
      ? `${state.config.styleName ?? state.config.title} · ${state.config.sourceName ?? ''}`.trim()
      : state.config.title
  }

  if (state.status === 'disabled') {
    return 'MVT 未启用'
  }

  if (state.status === 'loading') {
    return state.message
  }

  if (state.status === 'error') {
    return 'MVT 加载失败'
  }

  return 'MVT runtime'
})

function resetCamera() {
  viewer?.camera.flyHome(1.4)
}

function handleViewerReady(readyViewer: Viewer) {
  if (destroyed) {
    return
  }

  if (viewer && viewer !== readyViewer) {
    detachMvtRuntime()
    viewerConfigured = false
  }

  viewer = readyViewer

  if (viewerConfigured) {
    return
  }

  viewerConfigured = true

  viewer.scene.globe.baseColor = Color.fromCssColorString('#08111f')
  viewer.scene.globe.enableLighting = false
  viewer.scene.globe.showGroundAtmosphere = true
  viewer.scene.debugShowFramesPerSecond = true
  const skyAtmosphere = viewer.scene.skyAtmosphere
  if (skyAtmosphere) {
    skyAtmosphere.hueShift = -0.6
    skyAtmosphere.saturationShift = -0.2
    skyAtmosphere.brightnessShift = -0.15
  }
  viewer.scene.highDynamicRange = false

  ;(window as Window & { __CESIUM_VIEWER__?: Viewer }).__CESIUM_VIEWER__ = viewer

  void loadMvtRuntime()
  viewer.camera.flyHome(0)
}

watch(
  () => viewerRef.value,
  (readyViewer) => {
    if (!readyViewer) {
      return
    }

    handleViewerReady(readyViewer)
  },
  { immediate: true },
)

function detachMvtRuntime() {
  stopMvtSubscription?.()
  stopMvtSubscription = undefined

  mvtSceneAttachment?.destroy()
  mvtSceneAttachment = undefined

  mvtRuntime?.destroy()
  mvtRuntime = undefined

  mvtSnapshot.value = null
}

function attachMvtRuntime(config: OpenFreeMapMvtRuntimeConfig) {
  if (!viewer || !config.enabled) return

  const backgroundColor = config.style
    ? resolveMapLibreStyleBackgroundColor(config.style)
    : undefined
  if (backgroundColor) {
    viewer.scene.globe.baseColor = backgroundColor
    viewer.scene.backgroundColor = backgroundColor
  }

  mvtRuntime = createCesiumMvtRuntime({
    source: config.source,
    maxConcurrentRequests: config.maxConcurrentRequests,
    cacheSize: config.cacheSize,
  })
  mvtSceneAttachment = attachCesiumMvtScene({
    scene: viewer.scene,
    runtime: mvtRuntime,
    source: config.source,
    style: config.style,
  })

  stopMvtSubscription = mvtRuntime.subscribe((snapshot) => {
    mvtSnapshot.value = snapshot
  })
}

async function loadMvtRuntime() {
  if (!viewer) return

  detachMvtRuntime()

  loadAbortController?.abort()
  loadAbortController = new AbortController()
  runtimeState.value = { status: 'loading', message: '正在读取 style / TileJSON...' }

  try {
    const config = await resolveOpenFreeMapMvtRuntimeConfigFromEnv(
      loadAbortController.signal,
    )
    if (destroyed || loadAbortController.signal.aborted) return

    runtimeState.value = config.enabled
      ? { status: 'ready', config }
      : { status: 'disabled', config }

    if (config.enabled) {
      attachMvtRuntime(config)
    }
  } catch (error) {
    if (destroyed || loadAbortController?.signal.aborted) return

    runtimeState.value = {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Failed to resolve MVT runtime config.',
    }
  }
}

onBeforeUnmount(() => {
  destroyed = true

  loadAbortController?.abort()
  loadAbortController = undefined

  detachMvtRuntime()

  delete (window as Window & { __CESIUM_VIEWER__?: Viewer }).__CESIUM_VIEWER__
  viewer = undefined
  viewerConfigured = false
})
</script>

<template>
  <section class="hud">
    <p class="eyebrow">Vite + Vue 3 + TypeScript</p>
    <h1>Cesium 全屏地球</h1>
    <p class="description">
      这是一个使用 <code>unplugin-cesium</code> 接入的全屏 Cesium 页面。当前会从配置加载一个
      MapLibre 风格的 style，并把其中的 vector source 接进 MVT 调度层。
    </p>

    <div class="runtime-status">
      <div class="runtime-status__head">
        <span class="runtime-status__label">MVT 调度层</span>
        <span class="runtime-status__value">{{ mvtStatus }}</span>
      </div>

      <p class="runtime-status__summary">
        {{ mvtSummary }}
      </p>

      <p class="runtime-status__meta">
        {{ mvtMeta }}
      </p>
    </div>

    <div class="actions">
      <button type="button" class="hud-button" @click="resetCamera">
        回到初始视角
      </button>
    </div>
  </section>

  <div class="hud-chip">{{ mvtChipLabel }}</div>
</template>
