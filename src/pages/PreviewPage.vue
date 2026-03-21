<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type StageTimelineItem = {
  index: number
  name: string
  status: 'running' | 'completed'
  screenshot?: string
  deltaSummary: string
  placeholderMessage?: string
  renderMode?: {
    preference: 'auto' | 'svg' | 'canvas'
    actual: 'html' | 'svg' | 'canvas'
  }
  metrics?: {
    visualSimilarity: number
    focusedVisualSimilarity?: number
    overflowCount: number
    occlusionCount: number
    criticalIssueCount: number
  }
  debug?: {
    overallAdherenceRate: number
    addExecutionRate: number
    modifyExecutionRate: number
    overEditCount: number
  }
}

type TaskTimelineItem = {
  taskId: string
  createdAt: string
  updatedAt: string
  status: 'running' | 'completed'
  inputImage: string
  finalComponent?: string
  exitReason?: string
  activeStepLabel?: string
  bestStageIndex: number
  finalStageIndex: number
  comparisonGroupId?: string
  comparisonGroupLabel?: string
  caseId?: string
  caseLabel?: string
  versionLabel?: string
  versionTag?: string
  branchKind?: 'dom-svg' | 'canvas' | 'adhoc'
  stages: StageTimelineItem[]
}

type TimelineDocument = {
  version: string
  tasks: TaskTimelineItem[]
}

type TaskGroup = {
  key: string
  label: string
  caseLabel?: string
  tasks: TaskTimelineItem[]
}

const timeline = ref<TimelineDocument>({
  version: '1.0',
  tasks: [],
})

const loading = ref(true)
const errorMessage = ref('')
const expandedTaskIds = ref<string[]>([])

let refreshHandle: number | undefined

const tasks = computed(() => {
  const deduped = new Map<string, TaskTimelineItem>()

  for (const task of timeline.value.tasks) {
    const existing = deduped.get(task.taskId)
    if (!existing) {
      deduped.set(task.taskId, task)
      continue
    }

    const existingScore = existing.comparisonGroupId ? 1 : 0
    const currentScore = task.comparisonGroupId ? 1 : 0
    if (currentScore >= existingScore) {
      deduped.set(task.taskId, task)
    }
  }

  return [...deduped.values()].reverse()
})

function versionOrder(task: TaskTimelineItem) {
  const label = (task.versionLabel ?? '').toLowerCase()
  if (label.includes('baseline') || label.includes('旧')) {
    return 0
  }

  if (task.branchKind === 'canvas' || label.includes('canvas')) {
    return 2
  }

  return 1
}

const taskGroups = computed<TaskGroup[]>(() => {
  const groups = new Map<string, TaskGroup>()

  for (const task of tasks.value) {
    const key = task.comparisonGroupId ?? `task:${task.taskId}`
    const existing = groups.get(key)

    if (existing) {
      existing.tasks.push(task)
      continue
    }

    groups.set(key, {
      key,
      label: task.comparisonGroupLabel ?? task.caseLabel ?? task.taskId,
      caseLabel: task.caseLabel,
      tasks: [task],
    })
  }

  return [...groups.values()].map((group) => ({
    ...group,
    tasks: [...group.tasks].sort((left, right) => {
      const versionDelta = versionOrder(left) - versionOrder(right)
      if (versionDelta !== 0) {
        return versionDelta
      }

      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    }),
  }))
})

function ensureExpandedTaskState() {
  const known = new Set(expandedTaskIds.value)
  const next = [...expandedTaskIds.value]

  const runningTask = tasks.value.find((task) => task.status === 'running')
  if (runningTask && !known.has(runningTask.taskId)) {
    next.unshift(runningTask.taskId)
  }

  const latestTaskWithStages = tasks.value.find((task) => task.stages.length > 0)
  if (!next.length && latestTaskWithStages) {
    next.push(latestTaskWithStages.taskId)
  }

  if (!next.length && tasks.value[0]) {
    next.push(tasks.value[0].taskId)
  }

  expandedTaskIds.value = [...new Set(next)]
}

function normalizeTimeline(document: TimelineDocument): TimelineDocument {
  return {
    version: document.version ?? '1.0',
    tasks: (document.tasks ?? []).map((task) => ({
      ...task,
      updatedAt: task.updatedAt ?? task.createdAt,
      status: task.status ?? 'completed',
      exitReason: task.exitReason ?? 'legacy',
      stages: (task.stages ?? []).map((stage) => ({
        ...stage,
        status: stage.status ?? 'completed',
      })),
    })),
  }
}

async function loadTimeline() {
  try {
    const response = await fetch(`/artifacts/timeline.json?ts=${Date.now()}`)
    if (!response.ok) {
      throw new Error(`读取 timeline 失败: ${response.status}`)
    }

    timeline.value = normalizeTimeline((await response.json()) as TimelineDocument)
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '读取 timeline 时发生未知错误'
  } finally {
    loading.value = false
  }
}

function formatRate(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--'
  }

  return `${Math.round(value * 100)}%`
}

function formatRenderMode(stage: StageTimelineItem) {
  if (!stage.renderMode) {
    return '绘制 auto'
  }

  const actual = stage.renderMode.actual.toUpperCase()
  if (stage.renderMode.preference === 'auto') {
    return `绘制 ${actual} · 自动判断`
  }

  return `绘制 ${actual} · 偏好 ${stage.renderMode.preference.toUpperCase()}`
}

function isExpanded(taskId: string) {
  return expandedTaskIds.value.includes(taskId)
}

function toggleTask(taskId: string) {
  expandedTaskIds.value = isExpanded(taskId)
    ? expandedTaskIds.value.filter((value) => value !== taskId)
    : [...expandedTaskIds.value, taskId]
}

onMounted(async () => {
  await loadTimeline()
  ensureExpandedTaskState()
  refreshHandle = window.setInterval(loadTimeline, 1_200)
})

onBeforeUnmount(() => {
  if (refreshHandle) {
    window.clearInterval(refreshHandle)
  }
})

watch(tasks, () => {
  ensureExpandedTaskState()
})
</script>

<template>
  <main class="preview-shell">
    <header class="preview-header">
      <div>
        <p class="eyebrow">Design2Code Timeline</p>
        <h1>生成过程预览</h1>
      </div>
      <p class="preview-note">
        极简视图仅展示任务输入、阶段截图、变化摘要与调试遵从率。
      </p>
    </header>

    <section v-if="loading" class="empty-state">
      <p>正在读取任务时间线…</p>
    </section>

    <section v-else-if="errorMessage" class="empty-state">
      <p>{{ errorMessage }}</p>
    </section>

    <section v-else-if="!tasks.length" class="empty-state">
      <p>还没有生成任务，运行 `npm run task:verify -- --image /path/to/mock.png` 后会在这里出现。</p>
    </section>

    <section v-else class="task-grid">
      <article v-for="group in taskGroups" :key="group.key" class="task-group">
        <header class="group-header">
          <div>
            <p class="group-eyebrow">Comparison Group</p>
            <h2>{{ group.label }}</h2>
          </div>
          <span class="group-count">{{ group.tasks.length }} 个版本</span>
        </header>

        <div class="group-tasks">
          <article v-for="task in group.tasks" :key="task.taskId" class="task-row">
            <button class="task-toggle" type="button" @click="toggleTask(task.taskId)">
              <aside class="task-meta">
                <div class="task-badges">
                  <span v-if="task.versionLabel" class="task-badge task-badge--version">{{ task.versionLabel }}</span>
                  <span v-if="task.branchKind" class="task-badge">{{ task.branchKind }}</span>
                  <span v-if="task.versionTag" class="task-badge">{{ task.versionTag }}</span>
                </div>
                <p class="task-id">{{ task.taskId }}</p>
                <p class="task-time">{{ new Date(task.createdAt).toLocaleString() }}</p>
                <p class="task-exit">
                  {{ task.status === 'running' ? `进行中：${task.activeStepLabel ?? '处理中'}` : `退出：${task.exitReason}` }}
                </p>
                <p class="task-best">最佳阶段：{{ task.bestStageIndex || '--' }}</p>
              </aside>

              <span class="task-toggle-indicator">
                {{ isExpanded(task.taskId) ? '收起' : '展开' }}
              </span>
            </button>

            <div v-if="isExpanded(task.taskId)" class="stage-strip">
              <figure class="stage-card source-card">
                <img :src="`/${task.inputImage}`" alt="source reference" loading="lazy" />
                <figcaption>
                  <strong>原图</strong>
                  <span>{{ task.caseLabel ?? '输入设计图' }}</span>
                </figcaption>
              </figure>

              <figure
                v-if="task.status === 'running' && !task.stages.length"
                class="stage-card stage-card--running"
              >
                <div class="stage-placeholder" aria-hidden="true">
                  <div class="stage-placeholder-bar"></div>
                  <div class="stage-placeholder-bar stage-placeholder-bar--short"></div>
                  <div class="stage-placeholder-grid">
                    <span v-for="index in 6" :key="index" class="stage-placeholder-dot"></span>
                  </div>
                </div>
                <figcaption>
                  <strong>准备中</strong>
                  <span>{{ task.activeStepLabel ?? '正在解析设计图结构…' }}</span>
                  <small>阶段占位会在首个截图完成后即时替换。</small>
                </figcaption>
              </figure>

              <figure
                v-for="stage in task.stages"
                :key="`${task.taskId}-${stage.index}`"
                class="stage-card"
                :class="{ 'stage-card--running': stage.status === 'running' }"
              >
                <template v-if="stage.status === 'completed' && stage.screenshot">
                  <img :src="`/${stage.screenshot}`" :alt="`${stage.name} screenshot`" loading="lazy" />
                  <figcaption>
                    <strong>{{ stage.index }} · {{ stage.name }}</strong>
                    <span>{{ stage.deltaSummary }}</span>
                    <small>
                      相似度 {{ formatRate(stage.metrics?.visualSimilarity) }} ·
                      遵从率 {{ formatRate(stage.debug?.overallAdherenceRate) }}
                    </small>
                    <small>{{ formatRenderMode(stage) }}</small>
                    <small>
                      溢出 {{ stage.metrics?.overflowCount ?? '--' }} · 遮挡
                      {{ stage.metrics?.occlusionCount ?? '--' }} · 严重问题
                      {{ stage.metrics?.criticalIssueCount ?? '--' }}
                    </small>
                  </figcaption>
                </template>

                <template v-else>
                  <div class="stage-placeholder" aria-hidden="true">
                    <div class="stage-placeholder-bar"></div>
                    <div class="stage-placeholder-bar stage-placeholder-bar--short"></div>
                    <div class="stage-placeholder-grid">
                      <span v-for="index in 6" :key="index" class="stage-placeholder-dot"></span>
                    </div>
                  </div>
                  <figcaption>
                    <strong>{{ stage.index }} · {{ stage.name }}</strong>
                    <span>{{ stage.placeholderMessage ?? stage.deltaSummary }}</span>
                    <small>阶段进行中，完成后会立刻替换为最新截图。</small>
                  </figcaption>
                </template>
              </figure>
            </div>
          </article>
        </div>
      </article>
    </section>
  </main>
</template>
