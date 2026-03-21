import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { paths } from '../src/pipeline/config'
import { runTask } from '../src/pipeline/orchestrator'
import { ensureArtifactsLayout, updateTimeline } from '../src/pipeline/store'
import type { TaskTimelineSummary, TimelineDocument } from '../src/pipeline/types'
import { fileExists, readJson, writeJson } from '../src/pipeline/utils'

type RegressionCase = {
  id: string
  label: string
  imagePath: string
  prompt: string
}

type RegressionVersion = {
  key: string
  label: string
  versionTag: string
  branchKind: 'dom-svg' | 'canvas'
  mode: 'current' | 'worktree'
  ref?: string
  promptTransform?: (prompt: string) => string
}

const projectRoot = process.cwd()
const baselineWorktree = '/tmp/design2code-regression-baseline'

const cases: RegressionCase[] = [
  {
    id: 'grouped-bar',
    label: 'F2 Grouped Bar',
    imagePath: path.resolve('test-inputs/attached-single-chart.png'),
    prompt: '/svg/ F2 分组柱状图 interval grouped bar',
  },
  {
    id: 'line-timeseries',
    label: 'F2 Line',
    imagePath: path.resolve('test-inputs/截屏2026-03-21 23.21.17.png'),
    prompt: '/svg/ F2 折线图 line chart',
  },
  {
    id: 'stacked-step',
    label: 'F2 Stacked Combo',
    imagePath: path.resolve('test-inputs/截屏2026-03-21 23.26.00.png'),
    prompt: '/svg/ F2 组合图 stacked bar with dashed step line',
  },
  {
    id: 'donut',
    label: 'F2 Donut',
    imagePath: path.resolve('test-inputs/截屏2026-03-22 00.55.21.png'),
    prompt: '/svg/ F2 环形图 donut chart',
  },
  {
    id: 'radar',
    label: 'F2 Radar',
    imagePath: path.resolve('test-inputs/截屏2026-03-22 00.56.15.png'),
    prompt: '/svg/ F2 雷达图 radar chart',
  },
  {
    id: 'area-fixture',
    label: 'F2 Area',
    imagePath: path.resolve('test-inputs/fixture-f2-area.png'),
    prompt: '/svg/ F2 面积图 area chart',
  },
  {
    id: 'scatter-fixture',
    label: 'F2 Scatter',
    imagePath: path.resolve('test-inputs/fixture-f2-scatter.png'),
    prompt: '/svg/ F2 散点图 point scatter chart',
  },
  {
    id: 'training-infographic',
    label: 'Training Infographic',
    imagePath: path.resolve('test-inputs/uploaded-training-infographic.png'),
    prompt: '/svg/ 信息图 训练计划 卡片 infographic',
  },
]

const versions: RegressionVersion[] = [
  {
    key: 'baseline-dom-svg',
    label: 'baseline-dom-svg',
    versionTag: 'iteration-qwen-ocr-chart-scene',
    branchKind: 'dom-svg',
    mode: 'worktree',
    ref: 'iteration-qwen-ocr-chart-scene',
  },
  {
    key: 'dom-svg-v3',
    label: 'dom-svg-v3',
    versionTag: 'working-tree',
    branchKind: 'dom-svg',
    mode: 'current',
  },
  {
    key: 'canvas-v1',
    label: 'canvas-v1',
    versionTag: 'working-tree',
    branchKind: 'canvas',
    mode: 'current',
    promptTransform: (prompt) => prompt.replace('/svg/', '/canvas/'),
  },
]

function parseSelectedCaseIds() {
  const selected = new Set<string>()
  for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index]
    if (token === '--case') {
      const caseId = process.argv[index + 1]
      if (caseId) {
        selected.add(caseId)
        index += 1
      }
    }
  }
  return selected
}

async function ensureFixtureInputs() {
  const result = spawnSync('npm', ['run', 'fixtures:generate'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '生成 fixture 失败。')
  }
}

async function clearExistingRegressionEntries(activeCases: RegressionCase[]) {
  const timeline = await readJson<TimelineDocument>(paths.timelinePath).catch(() => ({
    version: '1.0',
    tasks: [] as TaskTimelineSummary[],
  }))

  const managedGroups = new Set(activeCases.map((entry) => `regression:${entry.id}`))
  timeline.tasks = timeline.tasks.filter(
    (task) => !task.comparisonGroupId || !managedGroups.has(task.comparisonGroupId),
  )
  await writeJson(paths.timelinePath, timeline)
}

async function ensureBaselineWorktree(ref: string) {
  if (!(await fileExists(baselineWorktree))) {
    const result = spawnSync(
      'git',
      ['worktree', 'add', '--force', '--detach', baselineWorktree, ref],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      },
    )

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || '创建 baseline worktree 失败。')
    }
  }

  const envPath = path.join(projectRoot, '.env.local')
  const worktreeEnvPath = path.join(baselineWorktree, '.env.local')
  if (await fileExists(envPath)) {
    await fs.copyFile(envPath, worktreeEnvPath)
  }

  const worktreeNodeModules = path.join(baselineWorktree, 'node_modules')
  if (!(await fileExists(worktreeNodeModules))) {
    await fs.symlink(path.join(projectRoot, 'node_modules'), worktreeNodeModules, 'dir')
  }
}

async function importExternalTask(params: {
  taskId: string
  worktreeRoot: string
  caseMeta: {
    comparisonGroupId: string
    comparisonGroupLabel: string
    caseId: string
    caseLabel: string
    versionLabel: string
    versionTag: string
    branchKind: 'dom-svg' | 'canvas'
  }
}) {
  const sourceTaskRoot = path.join(params.worktreeRoot, 'public', 'artifacts', 'tasks', params.taskId)
  const targetTaskRoot = path.join(paths.tasksRoot, params.taskId)
  await fs.cp(sourceTaskRoot, targetTaskRoot, { recursive: true, force: true })

  const sourceTimelinePath = path.join(params.worktreeRoot, 'public', 'artifacts', 'timeline.json')
  const timeline = await readJson<TimelineDocument>(sourceTimelinePath)
  const summary = timeline.tasks.find((task) => task.taskId === params.taskId)
  if (!summary) {
    throw new Error(`未在 baseline timeline 中找到任务 ${params.taskId}`)
  }

  await updateTimeline({
    ...summary,
    ...params.caseMeta,
  })
}

async function runCurrentVersion(version: RegressionVersion, testCase: RegressionCase) {
  return runTask({
    imagePath: testCase.imagePath,
    promptText: version.promptTransform ? version.promptTransform(testCase.prompt) : testCase.prompt,
    comparisonGroupId: `regression:${testCase.id}`,
    comparisonGroupLabel: testCase.label,
    caseId: testCase.id,
    caseLabel: testCase.label,
    versionLabel: version.label,
    versionTag: version.versionTag,
    branchKind: version.branchKind,
  })
}

async function runBaselineVersion(version: RegressionVersion, testCase: RegressionCase) {
  await ensureBaselineWorktree(version.ref ?? 'iteration-qwen-ocr-chart-scene')
  const prompt = version.promptTransform ? version.promptTransform(testCase.prompt) : testCase.prompt
  const result = spawnSync(
    'npm',
    ['run', 'task:verify', '--', '--image', testCase.imagePath, '--prompt', prompt],
    {
      cwd: baselineWorktree,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
      timeout: 1000 * 60 * 8,
    },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `baseline 运行失败: ${testCase.id}`)
  }

  const jsonStart = result.stdout.indexOf('{')
  const jsonEnd = result.stdout.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error(`无法解析 baseline 输出: ${result.stdout}`)
  }

  const payload = JSON.parse(result.stdout.slice(jsonStart, jsonEnd + 1)) as {
    taskId: string
  }

  await importExternalTask({
    taskId: payload.taskId,
    worktreeRoot: baselineWorktree,
    caseMeta: {
      comparisonGroupId: `regression:${testCase.id}`,
      comparisonGroupLabel: testCase.label,
      caseId: testCase.id,
      caseLabel: testCase.label,
      versionLabel: version.label,
      versionTag: version.versionTag,
      branchKind: version.branchKind,
    },
  })
}

async function main() {
  const selectedCaseIds = parseSelectedCaseIds()
  const activeCases =
    selectedCaseIds.size > 0 ? cases.filter((entry) => selectedCaseIds.has(entry.id)) : cases

  await ensureArtifactsLayout()
  await ensureFixtureInputs()
  await clearExistingRegressionEntries(activeCases)
  const failures: Array<{ caseId: string; version: string; error: string }> = []

  for (const testCase of activeCases) {
    if (!(await fileExists(testCase.imagePath))) {
      throw new Error(`回归图片不存在: ${testCase.imagePath}`)
    }

    for (const version of versions) {
      try {
        if (version.mode === 'current') {
          await runCurrentVersion(version, testCase)
        } else {
          await runBaselineVersion(version, testCase)
        }
      } catch (error) {
        failures.push({
          caseId: testCase.id,
          version: version.label,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        cases: activeCases.map((entry) => entry.id),
        versions: versions.map((entry) => entry.label),
        failures,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
