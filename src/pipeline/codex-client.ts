import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { codexConfig, projectRoot } from './config'
import { ensureDir } from './utils'

export interface CodexStructuredRequest {
  prompt: string
  schema: unknown
  imagePaths?: string[]
  cwd?: string
  label: string
}

function runProcess(args: string[], input: string, cwd: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(codexConfig.bin, args, {
      cwd,
      env: process.env,
      stdio: 'pipe',
    })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Codex 命令执行超时，已在 45000ms 后中止。`))
    }, 45_000)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(
        new Error(
          `Codex 命令执行失败，退出码 ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        ),
      )
    })

    child.stdin.write(input)
    child.stdin.end()
  })
}

export class CodexCliClient {
  async runStructured<T>(request: CodexStructuredRequest): Promise<T> {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'design2code-codex-'))
    const schemaPath = path.join(tempDirectory, `${request.label}.schema.json`)
    const outputPath = path.join(tempDirectory, `${request.label}.json`)

    await ensureDir(tempDirectory)
    await fs.writeFile(schemaPath, JSON.stringify(request.schema, null, 2), 'utf8')

    const args = [
      'exec',
      '-c',
      'model_reasoning_effort="low"',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
    ]

    if (codexConfig.model) {
      args.push('--model', codexConfig.model)
    }

    for (const imagePath of request.imagePaths ?? []) {
      args.push('--image', imagePath)
    }

    args.push('-')

    try {
      await runProcess(args, request.prompt, request.cwd ?? projectRoot)
      const rawOutput = await fs.readFile(outputPath, 'utf8')
      return JSON.parse(rawOutput) as T
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true })
    }
  }
}
