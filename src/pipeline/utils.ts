import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RenderPreference } from './types'

export function createTaskId(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('')

  const suffix = crypto.randomBytes(2).toString('hex')
  return `${stamp}-${suffix}`
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'stage'
}

export async function ensureDir(directoryPath: string) {
  await fs.mkdir(directoryPath, { recursive: true })
}

export async function writeJson(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

export async function writeText(filePath: string, value: string) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, value, 'utf8')
}

export async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function hashValue(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

export function hashJson(value: unknown) {
  return hashValue(stableStringify(value))
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`
}

export function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))
  return sorted[index] ?? 0
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getArgValue(flag: string, argv = process.argv.slice(2)) {
  const index = argv.indexOf(flag)
  if (index === -1) {
    return undefined
  }

  return argv[index + 1]
}

export function extractRenderPreference(promptText?: string): RenderPreference {
  if (!promptText) {
    return 'auto'
  }

  const match = promptText.match(/\/(svg|canvas)\//i)
  if (!match) {
    return 'auto'
  }

  return match[1]?.toLowerCase() === 'canvas' ? 'canvas' : 'svg'
}

export function delay(timeoutMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
