import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { paths } from '../src/pipeline/config'
import { runTask } from '../src/pipeline/orchestrator'
import { appendEvaluationRun, ensureArtifactsLayout, updateTimeline } from '../src/pipeline/store'
import type {
  EvaluationRun,
  EvaluationVersionResult,
  TaskTimelineSummary,
  TimelineDocument,
} from '../src/pipeline/types'
import { fileExists, readJson, writeJson } from '../src/pipeline/utils'

type RegressionCase = {
  id: string
  label: string
  imagePath: string
  prompt: string
  type?: string
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
    key: 'dom-svg-v5',
    label: 'dom-svg-v5',
    versionTag: 'working-tree',
    branchKind: 'dom-svg',
    mode: 'current',
  },
  {
    key: 'canvas-v2',
    label: 'canvas-v2',
    versionTag: 'working-tree',
    branchKind: 'canvas',
    mode: 'current',
    promptTransform: (prompt) => prompt.replace('/svg/', '/canvas/'),
  },
]

async function loadDataset(datasetPath: string) {
  const dataset = await readJson<{
    id: string
    label: string
    cases: RegressionCase[]
  }>(datasetPath)

  return {
    id: dataset.id,
    label: dataset.label,
    cases: dataset.cases.map((entry) => ({
      ...entry,
      imagePath: path.resolve(entry.imagePath),
    })),
  }
}

function parseSelectedCaseIds() {
  const selected = new Set<string>()
  let datasetPath = path.resolve('evals/datasets/core-regression.json')
  for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index]
    if (token === '--case') {
      const caseId = process.argv[index + 1]
      if (caseId) {
        selected.add(caseId)
        index += 1
      }
    }

    if (token === '--dataset') {
      const customPath = process.argv[index + 1]
      if (customPath) {
        datasetPath = path.resolve(customPath)
        index += 1
      }
    }
  }
  return {
    selected,
    datasetPath,
  }
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
  const { selected, datasetPath } = parseSelectedCaseIds()
  const dataset = await loadDataset(datasetPath)
  const activeCases =
    selected.size > 0 ? dataset.cases.filter((entry) => selected.has(entry.id)) : dataset.cases

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

  const timeline = await readJson<TimelineDocument>(paths.timelinePath)
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).stdout.trim()
  const currentTag = spawnSync('git', ['describe', '--tags', '--exact-match'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const runId = `eval-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const versionResults: EvaluationVersionResult[] = versions.map((version) => ({
    versionLabel: version.label,
    versionTag: version.versionTag,
    branchKind: version.branchKind,
    results: activeCases.map((testCase) => {
      const task = timeline.tasks
        .filter(
          (entry) =>
            entry.comparisonGroupId === `regression:${testCase.id}` &&
            entry.versionLabel === version.label,
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      const bestStage = task?.stages.find((stage) => stage.index === task.bestStageIndex) ?? task?.stages[0]

      const failure = failures.find(
        (entry) => entry.caseId === testCase.id && entry.version === version.label,
      )

      return {
        caseId: testCase.id,
        caseLabel: testCase.label,
        imagePath: testCase.imagePath,
        taskId: task?.taskId,
        exitReason: task?.exitReason,
        similarity: bestStage?.metrics?.visualSimilarity,
        focusedSimilarity: bestStage?.metrics?.focusedVisualSimilarity,
        structuralSimilarity: bestStage?.metrics?.structuralSimilarity,
        chartShapeSimilarity: bestStage?.metrics?.chartShapeSimilarity,
        criticalIssueCount: bestStage?.metrics?.criticalIssueCount,
        overflowCount: bestStage?.metrics?.overflowCount,
        occlusionCount: bestStage?.metrics?.occlusionCount,
        metExpectation: task?.exitReason === 'success',
        error: failure?.error,
      }
    }),
  }))

  const evaluationRun: EvaluationRun = {
    runId,
    createdAt: new Date().toISOString(),
    datasetId: dataset.id,
    datasetLabel: dataset.label,
    commit,
    tag: currentTag.status === 0 ? currentTag.stdout.trim() : undefined,
    cases: activeCases.map((entry) => ({
      caseId: entry.id,
      caseLabel: entry.label,
      imagePath: entry.imagePath,
    })),
    versions: versionResults,
  }

  await appendEvaluationRun(evaluationRun)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
