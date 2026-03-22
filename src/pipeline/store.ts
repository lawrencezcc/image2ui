import fs from 'node:fs/promises'
import path from 'node:path'

import { paths } from './config'
import type { EvaluationRun, TaskTimelineSummary, TaskTraceSummary, TimelineDocument } from './types'
import { ensureDir, fileExists, readJson, slugify, writeJson } from './utils'

export interface TaskPaths {
  taskRoot: string
  stagesRoot: string
  sourceRoot: string
  assetsRoot: string
  metaPath: string
  eventsPath: string
  issueHistoryPath: string
  debugStatsPath: string
  tracePath: string
}

export function getTaskPaths(taskId: string): TaskPaths {
  const taskRoot = path.join(paths.tasksRoot, taskId)

  return {
    taskRoot,
    stagesRoot: path.join(taskRoot, 'stages'),
    sourceRoot: path.join(taskRoot, 'stages', '00-source'),
    assetsRoot: path.join(taskRoot, 'assets'),
    metaPath: path.join(taskRoot, 'meta.json'),
    eventsPath: path.join(taskRoot, 'events.jsonl'),
    issueHistoryPath: path.join(taskRoot, 'issue-history.json'),
    debugStatsPath: path.join(taskRoot, 'debug-stats.json'),
    tracePath: path.join(taskRoot, 'trace.json'),
  }
}

export function getStageDirectoryName(index: number, name: string) {
  return `${String(index).padStart(2, '0')}-${slugify(name)}`
}

export function toPublicRelative(filePath: string) {
  return path.relative(paths.publicRoot, filePath).split(path.sep).join('/')
}

export async function ensureArtifactsLayout() {
  await ensureDir(paths.artifactsRoot)
  await ensureDir(paths.tasksRoot)
  await ensureDir(paths.runtimeRoot)
  await ensureDir(paths.evalsRoot)
  await ensureDir(paths.generatedAssetsRoot)

  if (!(await fileExists(paths.timelinePath))) {
    await writeJson(paths.timelinePath, {
      version: '1.0',
      tasks: [],
    } satisfies TimelineDocument)
  }
}

export async function prepareTaskDirectories(taskId: string) {
  const taskPaths = getTaskPaths(taskId)

  await ensureDir(taskPaths.taskRoot)
  await ensureDir(taskPaths.stagesRoot)
  await ensureDir(taskPaths.sourceRoot)
  await ensureDir(taskPaths.assetsRoot)

  return taskPaths
}

export async function appendEvent(taskId: string, event: Record<string, unknown>) {
  const taskPaths = getTaskPaths(taskId)
  await ensureDir(path.dirname(taskPaths.eventsPath))
  await fs.appendFile(
    taskPaths.eventsPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    })}\n`,
    'utf8',
  )
}

export async function updateTimeline(summary: TaskTimelineSummary) {
  const timeline: TimelineDocument = await readJson<TimelineDocument>(paths.timelinePath).catch(() => ({
    version: '1.0',
    tasks: [] as TaskTimelineSummary[],
  }))

  const existingIndex = timeline.tasks.findIndex((task) => task.taskId === summary.taskId)
  if (existingIndex >= 0) {
    timeline.tasks[existingIndex] = summary
  } else {
    timeline.tasks.push(summary)
  }

  await writeJson(paths.timelinePath, timeline)
}

export async function writeTrace(taskId: string, trace: TaskTraceSummary) {
  const taskPaths = getTaskPaths(taskId)
  await writeJson(taskPaths.tracePath, trace)
}

export async function appendEvaluationRun(run: EvaluationRun) {
  const history = await readJson<{ version: string; runs: EvaluationRun[] }>(paths.evalHistoryPath).catch(
    () => ({
      version: '1.0',
      runs: [] as EvaluationRun[],
    }),
  )

  history.runs.push(run)
  await writeJson(paths.evalHistoryPath, history)
  await writeJson(path.join(paths.evalsRoot, `${run.runId}.json`), run)
}
