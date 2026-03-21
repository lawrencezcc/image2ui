import fs from 'node:fs/promises'
import path from 'node:path'

import OpenAI from 'openai'

import { qwenVlConfig } from './config'

type ChatContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
    }

export interface QwenVlRequest {
  prompt: string
  imageUrls?: string[]
  imagePaths?: string[]
  systemPrompt?: string
  model?: string
}

export interface QwenVlResponse {
  text: string
  model: string
  usage?: OpenAI.Completions.CompletionUsage
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      throw new Error(`暂不支持的图像格式: ${extension || 'unknown'}`)
  }
}

async function toDataUrl(filePath: string) {
  const mimeType = inferMimeType(filePath)
  const bytes = await fs.readFile(filePath)
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function normalizeContent(content: string | Array<{ type?: string; text?: string }> | null | undefined) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  return ''
}

export class QwenVlClient {
  private readonly client: OpenAI
  private readonly defaultModel: string

  constructor(options?: { apiKey?: string; baseURL?: string; model?: string }) {
    const apiKey = options?.apiKey ?? process.env[qwenVlConfig.apiKeyEnv]
    if (!apiKey) {
      throw new Error(`缺少 ${qwenVlConfig.apiKeyEnv}，无法调用 Qwen VL 服务。`)
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: options?.baseURL ?? qwenVlConfig.baseURL,
      timeout: qwenVlConfig.timeoutMs,
    })
    this.defaultModel = options?.model ?? qwenVlConfig.model
  }

  async complete(request: QwenVlRequest): Promise<QwenVlResponse> {
    const content: ChatContentPart[] = []

    for (const imageUrl of request.imageUrls ?? []) {
      content.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
        },
      })
    }

    for (const imagePath of request.imagePaths ?? []) {
      content.push({
        type: 'image_url',
        image_url: {
          url: await toDataUrl(imagePath),
        },
      })
    }

    content.push({
      type: 'text',
      text: request.prompt,
    })

    const completion = await this.client.chat.completions.create({
      model: request.model ?? this.defaultModel,
      messages: [
        ...(request.systemPrompt
          ? [
              {
                role: 'system' as const,
                content: request.systemPrompt,
              },
            ]
          : []),
        {
          role: 'user',
          content,
        },
      ],
    })

    const text = normalizeContent(completion.choices[0]?.message?.content)
    if (!text) {
      throw new Error('Qwen VL 返回为空，未获得可用文本响应。')
    }

    return {
      text,
      model: completion.model,
      usage: completion.usage ?? undefined,
    }
  }
}
