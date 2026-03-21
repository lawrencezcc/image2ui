<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import CurrentStage from '../runtime/generated/CurrentStage.vue'

type RuntimeDocument = {
  taskId: string
  stageId: string
  width: number
  height: number
  background: string
}

const runtime = ref<RuntimeDocument>({
  taskId: 'runtime',
  stageId: 'placeholder',
  width: 960,
  height: 640,
  background: '#f3f4f6',
})

const isReady = ref(false)

const artboardStyle = computed(() => ({
  width: `${runtime.value.width}px`,
  height: `${runtime.value.height}px`,
  background: runtime.value.background,
}))

async function loadRuntime() {
  const response = await fetch(`/artifacts/runtime/current-stage.json?ts=${Date.now()}`)
  if (!response.ok) {
    throw new Error(`无法读取当前运行时元数据: ${response.status}`)
  }

  runtime.value = (await response.json()) as RuntimeDocument
}

onMounted(async () => {
  await loadRuntime()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      isReady.value = true
    })
  })
})
</script>

<template>
  <main class="render-shell">
    <section
      class="render-frame"
      :style="artboardStyle"
      :data-render-ready="isReady ? 'true' : 'false'"
      :data-task-id="runtime.taskId"
      :data-stage-id="runtime.stageId"
      data-artboard-frame="true"
    >
      <CurrentStage />
    </section>
  </main>
</template>
