import fs from 'node:fs/promises'
import path from 'node:path'

import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

import { paths, projectRoot, renderServer } from './config'
import type { RenderCapture, SceneDocument } from './types'
import { delay, ensureDir, hashJson, hashValue, writeJson, writeText } from './utils'

async function hashFile(filePath: string) {
  return hashValue(await fs.readFile(filePath, 'base64'))
}

export class StageRenderer {
  private browser?: Browser
  private server?: ViteDevServer

  get baseUrl() {
    return `http://${renderServer.host}:${renderServer.port}`
  }

  async start() {
    if (!this.server) {
      this.server = await createServer({
        root: projectRoot,
        logLevel: 'error',
        server: {
          host: renderServer.host,
          port: renderServer.port,
        },
      })

      await this.server.listen()
    }

    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
      })
    }
  }

  async stop() {
    await this.browser?.close()
    this.browser = undefined

    await this.server?.close()
    this.server = undefined
  }

  async renderStage(options: {
    taskId: string
    stageId: string
    componentSource: string
    scene: SceneDocument
    screenshotPath: string
    domSnapshotPath: string
  }): Promise<RenderCapture> {
    if (!this.browser || !this.server) {
      throw new Error('StageRenderer 尚未启动')
    }

    await ensureDir(paths.runtimeRoot)
    await writeText(paths.runtimeComponentPath, `${options.componentSource.trim()}\n`)
    await writeJson(paths.runtimeMetaPath, {
      taskId: options.taskId,
      stageId: options.stageId,
      width: Math.round(options.scene.artboard.width),
      height: Math.round(options.scene.artboard.height),
      background: options.scene.artboard.background,
    })

    await delay(180)

    const page = await this.browser.newPage({
      viewport: {
        width: Math.max(1280, Math.ceil(options.scene.artboard.width + 240)),
        height: Math.max(960, Math.ceil(options.scene.artboard.height + 240)),
      },
      deviceScaleFactor: 1,
    })

    try {
      await page.goto(`${this.baseUrl}/render?nonce=${Date.now()}`, {
        waitUntil: 'networkidle',
      })
      await page.waitForSelector('[data-render-ready="true"]', {
        timeout: 30_000,
      })
      await delay(120)

      const frame = page.locator('[data-artboard-frame="true"]')
      await ensureDir(path.dirname(options.screenshotPath))
      await frame.screenshot({
        path: options.screenshotPath,
      })

      const nodes = await page.evaluate(() => {
        const artboard = document.querySelector('[data-artboard-frame="true"]')
        const artboardRect = artboard?.getBoundingClientRect()

        if (!artboardRect) {
          return []
        }

        return Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]')).map((node) => {
          const rect = node.getBoundingClientRect()
          const style = window.getComputedStyle(node)
          const points = [
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
            [rect.left + 4, rect.top + 4],
            [rect.right - 4, rect.bottom - 4],
          ]

          const occluded = points.some(([x, y]) => {
            const topNode = document.elementFromPoint(x, y)?.closest('[data-node-id]')
            return Boolean(topNode && topNode !== node && !node.contains(topNode))
          })

          const lineHeight = Number.parseFloat(style.lineHeight)

          return {
            nodeId: node.dataset.nodeId ?? '',
            rect: {
              x: rect.left - artboardRect.left,
              y: rect.top - artboardRect.top,
              width: rect.width,
              height: rect.height,
            },
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            textContent: node.textContent?.trim() ?? '',
            zIndex: Number.parseInt(style.zIndex || '0', 10) || 0,
            visible:
              style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            occluded,
            fontSize: Number.parseFloat(style.fontSize) || 0,
            lineHeight: Number.isNaN(lineHeight) ? 0 : lineHeight,
          }
        })
      })

      await writeJson(options.domSnapshotPath, nodes)

      return {
        screenshotPath: options.screenshotPath,
        domSnapshotPath: options.domSnapshotPath,
        nodes,
        renderHash: await hashFile(options.screenshotPath),
        layoutHash: hashJson(nodes),
      }
    } finally {
      await page.close()
    }
  }
}
