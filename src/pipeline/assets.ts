import path from 'node:path'

import sharp from 'sharp'

import { paths, qwenImageConfig } from './config'
import { QwenImageClient } from './qwen-image-client'
import { toPublicRelative } from './store'
import type { SceneDocument } from './types'
import { clamp, ensureDir, fileExists, hashJson, slugify } from './utils'

function normalizeSize(width: number, height: number) {
  const safeWidth = Math.max(32, Math.round(width))
  const safeHeight = Math.max(32, Math.round(height))
  const longest = Math.max(safeWidth, safeHeight)

  if (longest <= 1024) {
    return safeWidth >= safeHeight ? '1024*768' : '768*1024'
  }

  return safeWidth >= safeHeight ? '1536*1024' : '1024*1536'
}

async function cropRegion(
  sourceImagePath: string,
  targetPath: string,
  frame: { x: number; y: number; width: number; height: number },
) {
  const metadata = await sharp(sourceImagePath).metadata()
  const width = metadata.width ?? 1
  const height = metadata.height ?? 1
  const left = clamp(Math.floor(frame.x), 0, width - 1)
  const top = clamp(Math.floor(frame.y), 0, height - 1)
  const cropWidth = clamp(Math.ceil(frame.width), 1, width - left)
  const cropHeight = clamp(Math.ceil(frame.height), 1, height - top)

  await sharp(sourceImagePath)
    .extract({
      left,
      top,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toFile(targetPath)
}

async function isMeaningfulAsset(imagePath: string) {
  const stats = await sharp(imagePath).stats()
  const channels = stats.channels.slice(0, 3)
  const meanStdDev = channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(channels.length, 1)
  return meanStdDev >= 3.5
}

export async function materializeSceneAssets(params: {
  scene: SceneDocument
  sourceImagePath: string
  assetsRoot: string
}) {
  const qwenImage =
    qwenImageConfig.allowGeneratedFallback && process.env[qwenImageConfig.apiKeyEnv]
      ? new QwenImageClient()
      : undefined
  await ensureDir(params.assetsRoot)

  const nodes = await Promise.all(
    params.scene.nodes.map(async (node) => {
      if (node.type !== 'image') {
        return node
      }

      const cacheKey =
        node.asset?.cacheKey ??
        slugify(`${node.id}-${hashJson(node.frame)}-${node.notes ?? node.name ?? 'asset'}`)
      const targetPath = path.join(params.assetsRoot, `${cacheKey}.png`)

      if (!(await fileExists(targetPath))) {
        await cropRegion(params.sourceImagePath, targetPath, node.frame)

        if (!(await isMeaningfulAsset(targetPath)) && qwenImage && node.asset?.prompt) {
          const generatedPath = path.join(paths.generatedAssetsRoot, `${cacheKey}.png`)
          const generated = await qwenImage.generate({
            prompt: node.asset.prompt,
            model: node.asset.source === 'generated' ? qwenImageConfig.proModel : qwenImageConfig.model,
            size: normalizeSize(node.frame.width, node.frame.height),
          })
          await qwenImage.downloadImage(generated.imageUrl, generatedPath)
          return {
            ...node,
            asset: {
              ...node.asset,
              src: toPublicRelative(generatedPath),
              source: 'generated' as const,
              cacheKey,
            },
          }
        }
      }

      return {
        ...node,
        asset: {
          ...node.asset,
          src: toPublicRelative(targetPath),
          source: node.asset?.source ?? 'crop',
          cacheKey,
        },
      }
    }),
  )

  return {
    ...params.scene,
    nodes,
  }
}
